/// Arg-iterator surface. Implemented by `OsIterator` and `SliceIterator`.
pub trait ArgIter<'a> {
    fn next(&mut self) -> Option<&'a [u8]>;
    /// Remaining unconsumed args as a slice (for `stop_after_positional_at`).
    fn remain(&self) -> &[&'a [u8]];
}

/// Pop the first element of `remain`, advancing the slice. Shared body for
/// `SliceIterator::next` / `OsIterator::next`.
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
    // `remain` borrows the process-global argv, so nothing is allocated per-call.
    pub remain: &'static [&'static [u8]],

    /// The executable path (this is the first argument passed to the program)
    /// TODO: Is it the right choice for this to be null? Maybe `init` should
    ///       return an error when we have no exe.
    pub exe_arg: Option<&'static [u8]>,
}

impl OsIterator {
    pub fn init() -> OsIterator {
        let mut res = OsIterator {
            exe_arg: None,
            remain: os_argv(),
        };
        res.exe_arg = res.next();
        res
    }

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

/// Process argv as a `&'static` slice of `&'static [u8]` — the process-global
/// view that includes `BUN_OPTIONS` injection.
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
}
