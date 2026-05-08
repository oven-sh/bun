//! Deprecated: Use `parse_ex` instead

use core::marker::PhantomData;

use crate::args::ArgIter;
use crate::streaming::{self, StreamingClap};
use crate::{Param, ParseOptions, Values};

// TODO(port): The Zig `ComptimeClap` is a type-generator
//   `fn ComptimeClap(comptime Id: type, comptime params: []const Param(Id)) type`.
// Its body iterates `params` at comptime to compute three counts (flags / single
// options / multi options) and a re-indexed `converted_params: []const Param(usize)`,
// then emits a struct with array fields sized by those counts.
//
// Stable Rust const generics cannot carry a `&[Param<Id>]`, and array field lengths
// cannot be associated-const expressions (`generic_const_exprs` is nightly). B-2
// therefore reshapes the result as a struct with `Vec`-backed storage sized at
// runtime from `params`. A `comptime_clap!` proc-macro (Phase B) can later restore
// the fixed-size arrays and compile-time name lookup.

/// Per-category counts derived from a param table (Zig: comptime loop lines 6–32).
struct Counts {
    flags: usize,
    single: usize,
    multi: usize,
}

/// Runtime equivalent of the Zig comptime conversion loop: re-indexes each param's
/// `id` to its slot within its category (flag/single/multi) and returns the counts.
pub fn convert_params<Id>(params: &[Param<Id>]) -> (Vec<Param<usize>>, usize, usize, usize) {
    let mut flags = 0usize;
    let mut single = 0usize;
    let mut multi = 0usize;
    let mut converted: Vec<Param<usize>> = Vec::with_capacity(params.len());
    for param in params {
        let mut index = 0usize;
        if param.names.long.is_some() || param.names.short.is_some() {
            let ptr = match param.takes_value {
                Values::None => &mut flags,
                Values::OneOptional | Values::One => &mut single,
                Values::Many => &mut multi,
            };
            index = *ptr;
            *ptr += 1;
        }
        converted.push(Param { id: index, names: param.names, takes_value: param.takes_value });
    }
    (converted, flags, single, multi)
}

/// Deprecated: Use `parse_ex` instead
pub struct ComptimeClap<Id> {
    // Field order matches comptime.zig.
    // Inner `&'static [u8]` slices borrow argv (process-lifetime); never freed in Zig `deinit`.
    pub single_options: Vec<Option<&'static [u8]>>,
    pub multi_options: Vec<Box<[&'static [u8]]>>,
    pub flags: Vec<bool>,
    pub pos: Box<[&'static [u8]]>,
    pub passthrough_positionals: Box<[&'static [u8]]>,
    // `mem.Allocator param` field deleted — global mimalloc (see PORTING.md §Allocators).

    // Zig captures `converted_params` as a comptime const on the returned type; Rust
    // carries it as data so `flag`/`option`/`options`/`has_flag` can resolve names.
    converted_params: Vec<Param<usize>>,
    _id: PhantomData<Id>,
}

impl<Id> ComptimeClap<Id> {
    /// `iter` must yield `&'static [u8]` (process-lifetime args, e.g. `OsIterator`)
    /// because parsed values are stored by reference.
    pub fn parse<I>(
        params: &[Param<Id>],
        iter: &mut I,
        opt: ParseOptions<'_>,
    ) -> Result<Self, bun_core::Error>
    where
        I: ArgIter<'static>,
    // TODO(port): narrow error set
    {
        let (converted_params, n_flags, n_single, n_multi) = convert_params(params);

        // `opt.allocator` dropped — global mimalloc.
        let mut multis: Vec<Vec<&'static [u8]>> = (0..n_multi).map(|_| Vec::new()).collect();

        let mut pos: Vec<&'static [u8]> = Vec::new();
        let mut passthrough_positionals: Vec<&'static [u8]> = Vec::new();

        let mut single_options: Vec<Option<&'static [u8]>> = vec![None; n_single];
        let mut flags: Vec<bool> = vec![false; n_flags];

        // Zig: `StreamingClap(usize, @typeInfo(@TypeOf(iter)).pointer.child)` — the second
        // type arg is the pointee of `iter`; in Rust that is just `I`.
        let mut stream = StreamingClap::<usize, I> {
            params: &converted_params,
            iter,
            diagnostic: opt.diagnostic,
            state: streaming::State::Normal,
            positional: None,
        };

        while let Some(arg) = stream.next()? {
            let param = arg.param;
            if param.names.long.is_none() && param.names.short.is_none() {
                pos.push(arg.value.unwrap());
                if opt.stop_after_positional_at > 0
                    && pos.len() >= opt.stop_after_positional_at
                {
                    let mut remaining_ = stream.iter.remain();
                    // PORT NOTE: Zig called `bun.span` (NUL-scan) on `[:0]const u8` argv
                    // entries. Our `ArgIter` already yields sized `&[u8]`, so `span` is a
                    // no-op and is dropped.
                    let first: &[u8] = if !remaining_.is_empty() { remaining_[0] } else { b"" };
                    if !first.is_empty() && first == b"--" {
                        remaining_ = &remaining_[1..];
                    }

                    passthrough_positionals.reserve_exact(remaining_.len());
                    for arg_ in remaining_ {
                        passthrough_positionals.push(*arg_);
                        // PERF(port): was appendAssumeCapacity — profile in Phase B
                    }
                    break;
                }
            } else if param.takes_value == Values::One || param.takes_value == Values::OneOptional {
                debug_assert!(single_options.len() != 0);
                if single_options.len() != 0 {
                    single_options[param.id] = Some(arg.value.unwrap_or(b""));
                }
            } else if param.takes_value == Values::Many {
                debug_assert!(multis.len() != 0);
                if multis.len() != 0 {
                    multis[param.id].push(arg.value.unwrap());
                }
            } else {
                debug_assert!(flags.len() != 0);
                if flags.len() != 0 {
                    flags[param.id] = true;
                }
            }
        }

        Ok(Self {
            single_options,
            // PORT NOTE: Zig left these `undefined` and filled them post-loop.
            multi_options: multis.into_iter().map(Vec::into_boxed_slice).collect(),
            flags,
            pos: pos.into_boxed_slice(),
            passthrough_positionals: passthrough_positionals.into_boxed_slice(),
            converted_params,
            _id: PhantomData,
        })
    }

    // Zig `deinit` only freed `multi_options[*]` and `pos` (not `passthrough_positionals` —
    // likely a leak in the deprecated Zig). All are owned here, so `Drop` handles it;
    // body deleted per PORTING.md §Idiom map (`pub fn deinit` → `impl Drop`, empty body
    // when it only frees owned fields).

    pub fn flag(&self, name: &[u8]) -> bool {
        let param = self.find_param(name);
        // TODO(port): was `@compileError` — runtime assert in Phase A.
        debug_assert!(
            param.takes_value == Values::None || param.takes_value == Values::OneOptional,
            "{} is an option and not a flag.",
            bstr::BStr::new(name),
        );

        self.flags[param.id]
    }

    pub fn option(&self, name: &[u8]) -> Option<&'static [u8]> {
        let param = self.find_param(name);
        // TODO(port): was `@compileError` — runtime assert in Phase A.
        debug_assert!(
            param.takes_value != Values::None,
            "{} is a flag and not an option.",
            bstr::BStr::new(name),
        );
        debug_assert!(
            param.takes_value != Values::Many,
            "{} takes many options, not one.",
            bstr::BStr::new(name),
        );
        self.single_options[param.id]
    }

    pub fn options(&self, name: &[u8]) -> &[&'static [u8]] {
        let param = self.find_param(name);
        // TODO(port): was `@compileError` — runtime assert in Phase A.
        debug_assert!(
            param.takes_value != Values::None,
            "{} is a flag and not an option.",
            bstr::BStr::new(name),
        );
        debug_assert!(
            !(param.takes_value == Values::One || param.takes_value == Values::OneOptional),
            "{} takes one option, not multiple.",
            bstr::BStr::new(name),
        );

        &self.multi_options[param.id]
    }

    pub fn positionals(&self) -> &[&'static [u8]] {
        &self.pos
    }

    pub fn remaining(&self) -> &[&'static [u8]] {
        &self.passthrough_positionals
    }

    // TODO(port): Zig `hasFlag` is a comptime-only fn (no `self`) over the captured
    // `converted_params` const. Rust takes the slice explicitly so it can be called
    // without a parsed instance; a Phase-B proc-macro can restore the const-eval form.
    pub fn has_flag(params: &[Param<Id>], name: &[u8]) -> bool {
        for param in params {
            if let Some(s) = param.names.short {
                // Zig: mem.eql(u8, name, "-" ++ [_]u8{s})
                if name.len() == 2 && name[0] == b'-' && name[1] == s {
                    return true;
                }
            }
            if let Some(l) = param.names.long {
                // Zig: mem.eql(u8, name, "--" ++ l)
                if name.len() >= 2 && &name[..2] == b"--" && &name[2..] == l {
                    return true;
                }
            }
            // Check aliases
            for alias in param.names.long_aliases {
                if name.len() >= 2 && &name[..2] == b"--" && &name[2..] == *alias {
                    return true;
                }
            }
        }

        false
    }

    // TODO(port): Zig `findParam` is comptime-only and emits `@compileError` on miss.
    // Phase A does a runtime scan and panics on miss; the Phase-B proc-macro should
    // resolve names at compile time.
    fn find_param(&self, name: &[u8]) -> &Param<usize> {
        for param in &self.converted_params {
            if let Some(s) = param.names.short {
                if name.len() == 2 && name[0] == b'-' && name[1] == s {
                    return param;
                }
            }
            if let Some(l) = param.names.long {
                if name.len() >= 2 && &name[..2] == b"--" && &name[2..] == l {
                    return param;
                }
            }
            // Check aliases
            for alias in param.names.long_aliases {
                if name.len() >= 2 && &name[..2] == b"--" && &name[2..] == *alias {
                    return param;
                }
            }
        }

        unreachable!("{} is not a parameter.", bstr::BStr::new(name));
    }
}

// ported from: src/clap/comptime.zig
