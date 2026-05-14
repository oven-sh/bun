use core::convert::Infallible;
use std::borrow::Cow;

/// Duck-typed arg-iterator surface (Zig used `anytype`). Implemented by
/// `OsIterator` and `SliceIterator`; `ShellIterator` does not fit (fallible,
/// owned results) and is used standalone.
pub trait ArgIter<'a> {
    fn next(&mut self) -> Option<&'a [u8]>;
    /// Remaining unconsumed args as a slice (for `stop_after_positional_at`).
    fn remain(&self) -> &[&'a [u8]];
}

/// An example of what methods should be implemented on an arg iterator.
pub struct ExampleArgIterator;

impl ExampleArgIterator {
    pub fn next(&mut self) -> Result<Option<&'static [u8]>, Infallible> {
        Ok(Some(b"2"))
    }
}

/// Pop the first element of `remain`, advancing the slice. Shared body for
/// `SliceIterator::next` / `OsIterator::next` (the .zig spec duplicates them).
#[inline]
fn pop_first<'a>(remain: &mut &'a [&'a [u8]]) -> Option<&'a [u8]> {
    if remain.is_empty() {
        return None;
    }
    let res = remain[0];
    *remain = &remain[1..];
    Some(res)
}

/// An argument iterator which iterates over a slice of arguments.
/// This implementation does not allocate.
pub struct SliceIterator<'a> {
    pub remain: &'a [&'a [u8]],
}

impl<'a> SliceIterator<'a> {
    pub fn init(args: &'a [&'a [u8]]) -> SliceIterator<'a> {
        SliceIterator { remain: args }
    }

    pub fn next(&mut self) -> Option<&'a [u8]> {
        pop_first(&mut self.remain)
    }
}

impl<'a> ArgIter<'a> for SliceIterator<'a> {
    #[inline]
    fn next(&mut self) -> Option<&'a [u8]> {
        SliceIterator::next(self)
    }
    #[inline]
    fn remain(&self) -> &[&'a [u8]] {
        self.remain
    }
}

/// An argument iterator which wraps the ArgIterator in ::std.
/// On windows, this iterator allocates.
pub struct OsIterator {
    // PORT NOTE: the Zig `arena: bun.ArenaAllocator` field was dropped — non-AST crate,
    // and `remain` borrows the process-global argv so nothing is allocated per-call.
    pub remain: &'static [&'static [u8]],

    /// The executable path (this is the first argument passed to the program)
    /// TODO: Is it the right choice for this to be null? Maybe `init` should
    ///       return an error when we have no exe.
    pub exe_arg: Option<&'static [u8]>,
}

impl OsIterator {
    // TODO(port): Zig aliased `process.ArgIterator.InitError`; no std::process here.

    pub fn init() -> OsIterator {
        let mut res = OsIterator {
            exe_arg: None,
            remain: os_argv(),
        };
        res.exe_arg = res.next();
        res
    }

    // PORT NOTE: `deinit` dropped — it only freed the arena, which no longer exists.

    pub fn next(&mut self) -> Option<&'static [u8]> {
        pop_first(&mut self.remain)
    }
}

impl ArgIter<'static> for OsIterator {
    #[inline]
    fn next(&mut self) -> Option<&'static [u8]> {
        OsIterator::next(self)
    }
    #[inline]
    fn remain(&self) -> &[&'static [u8]] {
        self.remain
    }
}

/// Process argv as a `&'static` slice of `&'static [u8]`.
///
/// Zig: `bun.argv: [][:0]const u8` — the process-global view that includes
/// `BUN_OPTIONS` injection.
///
/// This used to project `&ZStr → &[u8]` through a `OnceLock<Vec<&[u8]>>`,
/// which (a) allocated a Vec on the `--version` startup path and (b) emitted a
/// distinct `OnceLock<Vec<&[u8]>>::initialize` / `Once::call_once_force`
/// monomorphisation that perf showed faulting in its own 4 KB `.text` page.
/// `bun_core::ZStr` is `#[repr(transparent)]` over `[u8]`, so `&ZStr` and
/// `&[u8]` are layout-identical fat pointers — reinterpret the process-static
/// `[&ZStr]` view in place: zero alloc, zero lazy-init shim, zero extra
/// `.text`.
#[inline]
fn os_argv() -> &'static [&'static [u8]] {
    let z: &'static [&'static bun_core::ZStr] = bun_core::argv().as_slice();
    // SAFETY: `#[repr(transparent)] struct ZStr([u8])` (bun_core/util.rs) ⇒
    // `&ZStr` and `&[u8]` have identical (ptr, len) layout, hence so do
    // `[&ZStr]` and `[&[u8]]`. The slice is process-static.
    unsafe { core::slice::from_raw_parts(z.as_ptr().cast::<&'static [u8]>(), z.len()) }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr)]
pub enum ShellIteratorError {
    #[error("DanglingEscape")]
    DanglingEscape,
    #[error("QuoteNotClosed")]
    QuoteNotClosed,
    // PORT NOTE: Zig union included `mem.Allocator.Error` (OutOfMemory). Vec aborts on OOM
    // under the global mimalloc allocator, so that variant is dropped.
}

bun_core::named_error_set!(ShellIteratorError);

/// An argument iterator that takes a string and parses it into arguments, simulating
/// how shells split arguments.
pub struct ShellIterator<'a> {
    // PORT NOTE: the Zig `arena: bun.ArenaAllocator` field was dropped (non-AST crate).
    // Allocated results are returned as `Cow::Owned` instead of arena-backed slices.
    pub str: &'a [u8],
}

#[derive(Clone, Copy)]
enum State {
    SkipWhitespace,
    NoQuote,
    NoQuoteEscape,
    SingleQuote,
    DoubleQuote,
    DoubleQuoteEscape,
    AfterQuote,
}

impl<'a> ShellIterator<'a> {
    pub fn init(str: &'a [u8]) -> ShellIterator<'a> {
        ShellIterator { str }
    }

    // PORT NOTE: `deinit` dropped — it only freed the arena, which no longer exists.

    pub fn next(&mut self) -> Result<Option<Cow<'a, [u8]>>, ShellIteratorError> {
        // Whenever possible, this iterator will return slices into `str` instead of
        // allocating. Sometimes this is not possible, for example, escaped characters
        // have be be unescape, so we need to allocate in this case.
        let mut list: Vec<u8> = Vec::new();
        let mut start: usize = 0;
        let mut state = State::SkipWhitespace;

        // PORT NOTE: reshaped for borrowck — copy the slice ref so we can reassign
        // `self.str` before returning (Zig used `defer iter.str = ...`).
        let s: &'a [u8] = self.str;

        for (i, &c) in s.iter().enumerate() {
            match state {
                // The state that skips the initial whitespace.
                State::SkipWhitespace => match c {
                    b' ' | b'\t' | b'\n' => {}
                    b'\'' => {
                        start = i + 1;
                        state = State::SingleQuote;
                    }
                    b'"' => {
                        start = i + 1;
                        state = State::DoubleQuote;
                    }
                    b'\\' => {
                        start = i + 1;
                        state = State::NoQuoteEscape;
                    }
                    _ => {
                        start = i;
                        state = State::NoQuote;
                    }
                },

                // The state that parses the none quoted part of a argument.
                State::NoQuote => match c {
                    // We're done parsing a none quoted argument when we hit a
                    // whitespace.
                    b' ' | b'\t' | b'\n' => {
                        let res = Self::result(s, start, i, list);
                        self.str = &s[i..];
                        return res;
                    }

                    // Slicing is not possible if a quote starts while parsing none
                    // quoted args.
                    // Example:
                    // ab'cd' -> abcd
                    b'\'' => {
                        list.extend_from_slice(&s[start..i]);
                        start = i + 1;
                        state = State::SingleQuote;
                    }
                    b'"' => {
                        list.extend_from_slice(&s[start..i]);
                        start = i + 1;
                        state = State::DoubleQuote;
                    }

                    // Slicing is not possible if we need to escape a character.
                    // Example:
                    // ab\"d -> ab"d
                    b'\\' => {
                        list.extend_from_slice(&s[start..i]);
                        start = i + 1;
                        state = State::NoQuoteEscape;
                    }
                    _ => {}
                },

                // We're in this state after having parsed the quoted part of an
                // argument. This state works mostly the same as .no_quote, but
                // is aware, that the last character seen was a quote, which should
                // not be part of the argument. This is why you will see `i - 1` here
                // instead of just `i` when `iter.str` is sliced.
                State::AfterQuote => match c {
                    b' ' | b'\t' | b'\n' => {
                        let res = Self::result(s, start, i - 1, list);
                        self.str = &s[i..];
                        return res;
                    }
                    b'\'' => {
                        list.extend_from_slice(&s[start..i - 1]);
                        start = i + 1;
                        state = State::SingleQuote;
                    }
                    b'"' => {
                        list.extend_from_slice(&s[start..i - 1]);
                        start = i + 1;
                        state = State::DoubleQuote;
                    }
                    b'\\' => {
                        list.extend_from_slice(&s[start..i - 1]);
                        start = i + 1;
                        state = State::NoQuoteEscape;
                    }
                    _ => {
                        list.extend_from_slice(&s[start..i - 1]);
                        start = i;
                        state = State::NoQuote;
                    }
                },

                // The states that parse the quoted part of arguments. The only differnece
                // between single and double quoted arguments is that single quoted
                // arguments ignore escape sequences, while double quoted arguments
                // does escaping.
                State::SingleQuote => match c {
                    b'\'' => state = State::AfterQuote,
                    _ => {}
                },
                State::DoubleQuote => match c {
                    b'"' => state = State::AfterQuote,
                    b'\\' => {
                        list.extend_from_slice(&s[start..i]);
                        start = i + 1;
                        state = State::DoubleQuoteEscape;
                    }
                    _ => {}
                },

                // The state we end up when after the escape character (`\`). All these
                // states do is transition back into the previous state.
                // TODO: Are there any escape sequences that does transform the second
                //       character into something else? For example, in Zig, `\n` is
                //       transformed into the line feed ascii character.
                State::NoQuoteEscape => {
                    state = State::NoQuote;
                }
                State::DoubleQuoteEscape => {
                    state = State::DoubleQuote;
                }
            }
        }

        self.str = &s[s.len()..];
        match state {
            State::SkipWhitespace => Ok(None),
            State::NoQuote => Self::result(s, start, s.len(), list),
            State::AfterQuote => Self::result(s, start, s.len() - 1, list),
            State::NoQuoteEscape => Err(ShellIteratorError::DanglingEscape),
            State::SingleQuote | State::DoubleQuote | State::DoubleQuoteEscape => {
                Err(ShellIteratorError::QuoteNotClosed)
            }
        }
    }

    fn result(
        s: &'a [u8],
        start: usize,
        end: usize,
        mut list: Vec<u8>,
    ) -> Result<Option<Cow<'a, [u8]>>, ShellIteratorError> {
        let res = &s[start..end];

        // If we already have something in `list` that means that we could not
        // parse the argument without allocation. We therefor need to just append
        // the rest we have to the list and return that.
        if !list.is_empty() {
            list.extend_from_slice(res);
            // PERF(port): was arena-backed `toOwnedSlice()` — profile in Phase B
            return Ok(Some(Cow::Owned(list)));
        }
        Ok(Some(Cow::Borrowed(res)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slice_iterator() {
        let args: &[&[u8]] = &[b"A", b"BB", b"CCC"];
        let mut iter = SliceIterator { remain: args };

        for a in args {
            let b = SliceIterator::next(&mut iter);
            debug_assert!(*a == b.unwrap());
        }
    }

    fn test_shell_iterator_ok(str: &[u8], allocations: usize, expect: &[&[u8]]) {
        // TODO(port): Zig used `testing.FailingAllocator` to cap/count allocations.
        // No allocator injection in the Rust port; `allocations` is unused.
        let _ = allocations;
        let mut it = ShellIterator::init(str);

        for e in expect {
            match it.next() {
                Ok(actual) => {
                    assert!(actual.is_some());
                    assert_eq!(*e, &*actual.unwrap());
                }
                Err(err) => panic!("expected {:?}, got error {:?}", e, err),
            }
        }

        match it.next() {
            Ok(actual) => {
                assert!(actual.is_none());
                // TODO(port): assert_eq!(allocations, allocator.allocations);
            }
            Err(err) => panic!("expected end of iterator, got error {:?}", err),
        }
    }

    fn test_shell_iterator_err(str: &[u8], expect: ShellIteratorError) {
        let mut it = ShellIterator::init(str);

        loop {
            match it.next() {
                Ok(Some(_)) => {}
                Ok(None) => break,
                Err(err) => {
                    assert_eq!(expect, err);
                    return;
                }
            }
        }

        panic!("expected error {:?}, got end of iterator", expect);
    }

    #[test]
    fn shell_iterator() {
        test_shell_iterator_ok(b"a", 0, &[b"a"]);
        test_shell_iterator_ok(b"'a'", 0, &[b"a"]);
        test_shell_iterator_ok(b"\"a\"", 0, &[b"a"]);
        test_shell_iterator_ok(b"a b", 0, &[b"a", b"b"]);
        test_shell_iterator_ok(b"'a' b", 0, &[b"a", b"b"]);
        test_shell_iterator_ok(b"\"a\" b", 0, &[b"a", b"b"]);
        test_shell_iterator_ok(b"a 'b'", 0, &[b"a", b"b"]);
        test_shell_iterator_ok(b"a \"b\"", 0, &[b"a", b"b"]);
        test_shell_iterator_ok(b"'a b'", 0, &[b"a b"]);
        test_shell_iterator_ok(b"\"a b\"", 0, &[b"a b"]);
        test_shell_iterator_ok(b"\"a\"\"b\"", 1, &[b"ab"]);
        test_shell_iterator_ok(b"'a''b'", 1, &[b"ab"]);
        test_shell_iterator_ok(b"'a'b", 1, &[b"ab"]);
        test_shell_iterator_ok(b"a'b'", 1, &[b"ab"]);
        test_shell_iterator_ok(b"a\\ b", 1, &[b"a b"]);
        test_shell_iterator_ok(b"\"a\\ b\"", 1, &[b"a b"]);
        test_shell_iterator_ok(b"'a\\ b'", 0, &[b"a\\ b"]);
        test_shell_iterator_ok(b"   a     b      ", 0, &[b"a", b"b"]);
        test_shell_iterator_ok(b"\\  \\ ", 0, &[b" ", b" "]);

        test_shell_iterator_ok(
            br"printf 'run\nuninstall\n'",
            0,
            &[b"printf", br"run\nuninstall\n"],
        );
        test_shell_iterator_ok(
            br#"setsid -f steam "steam://$action/$id""#,
            0,
            &[b"setsid", b"-f", b"steam", b"steam://$action/$id"],
        );
        test_shell_iterator_ok(
            b"xargs -I% rg --no-heading --no-line-number --only-matching\n    --case-sensitive --multiline --text --byte-offset '(?-u)%' $@\n",
            0,
            &[
                b"xargs", b"-I%", b"rg", b"--no-heading",
                b"--no-line-number", b"--only-matching", b"--case-sensitive", b"--multiline",
                b"--text", b"--byte-offset", b"(?-u)%", b"$@",
            ],
        );

        test_shell_iterator_err(b"'a", ShellIteratorError::QuoteNotClosed);
        test_shell_iterator_err(b"'a\\", ShellIteratorError::QuoteNotClosed);
        test_shell_iterator_err(b"\"a", ShellIteratorError::QuoteNotClosed);
        test_shell_iterator_err(b"\"a\\", ShellIteratorError::QuoteNotClosed);
        test_shell_iterator_err(b"a\\", ShellIteratorError::DanglingEscape);
    }
}

// ported from: src/clap/args.zig
