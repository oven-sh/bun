//! Deprecated: Use `parse_ex` instead

use core::marker::PhantomData;

use crate::{Param, ParseOptions, StreamingClap, Values};

// TODO(port): The Zig `ComptimeClap` is a type-generator
//   `fn ComptimeClap(comptime Id: type, comptime params: []const Param(Id)) type`.
// Its body iterates `params` at comptime to compute three counts (flags / single
// options / multi options) and a re-indexed `converted_params: []const Param(usize)`,
// then emits a struct with array fields sized by those counts.
//
// Stable Rust const generics cannot carry a `&[Param<Id>]`, and array field lengths
// cannot be associated-const expressions (`generic_const_exprs` is nightly). Phase A
// therefore models the result as a struct generic over the three counts, with
// `converted_params` supplied as a `&'static` slice. A `comptime_clap!` proc-macro
// (Phase B) must perform the comptime loop (comptime.zig lines 6–32) to instantiate
// `ComptimeClap<Id, FLAGS, SINGLE, MULTI>` and produce the matching
// `CONVERTED_PARAMS` static for each call site.

/// Deprecated: Use `parse_ex` instead
pub struct ComptimeClap<Id, const FLAGS: usize, const SINGLE: usize, const MULTI: usize> {
    // Field order matches comptime.zig.
    // Inner `&'static [u8]` slices borrow argv (process-lifetime); never freed in Zig `deinit`.
    pub single_options: [Option<&'static [u8]>; SINGLE],
    pub multi_options: [Box<[&'static [u8]]>; MULTI],
    pub flags: [bool; FLAGS],
    pub pos: Box<[&'static [u8]]>,
    pub passthrough_positionals: Box<[&'static [u8]]>,
    // `allocator: mem.Allocator` field deleted — global mimalloc (see PORTING.md §Allocators).

    // Zig captures `converted_params` as a comptime const on the returned type; Rust
    // carries it as data so `flag`/`option`/`options`/`has_flag` can resolve names.
    converted_params: &'static [Param<usize>],
    _id: PhantomData<Id>,
}

impl<Id, const FLAGS: usize, const SINGLE: usize, const MULTI: usize>
    ComptimeClap<Id, FLAGS, SINGLE, MULTI>
{
    pub fn parse<I>(
        converted_params: &'static [Param<usize>],
        iter: &mut I,
        opt: ParseOptions,
    ) -> Result<Self, bun_core::Error>
    // TODO(port): narrow error set
    {
        // `opt.allocator` dropped — global mimalloc.
        // TODO(port): `[MULTI]` array of Vec requires `Vec<..>: Copy` for `[v; N]` init on
        // stable; Phase B may need `core::array::from_fn`.
        let mut multis: [Vec<&'static [u8]>; MULTI] = core::array::from_fn(|_| Vec::new());

        let mut pos: Vec<&'static [u8]> = Vec::new();
        let mut passthrough_positionals: Vec<&'static [u8]> = Vec::new();

        let mut res = Self {
            single_options: [None; SINGLE],
            // PORT NOTE: Zig left these `undefined` and filled them post-loop; Rust needs a
            // valid value. `Box::default()` is an empty slice.
            multi_options: core::array::from_fn(|_| Box::default()),
            flags: [false; FLAGS],
            pos: Box::default(),
            passthrough_positionals: Box::default(),
            converted_params,
            _id: PhantomData,
        };

        // Zig: `StreamingClap(usize, @typeInfo(@TypeOf(iter)).pointer.child)` — the second
        // type arg is the pointee of `iter`; in Rust that is just `I`.
        let mut stream = StreamingClap::<usize, I> {
            params: converted_params,
            iter,
            diagnostic: opt.diagnostic,
            // TODO(port): remaining StreamingClap fields (state) default-initialized in Zig.
            ..Default::default()
        };

        while let Some(arg) = stream.next()? {
            let param = arg.param;
            if param.names.long.is_none() && param.names.short.is_none() {
                pos.push(arg.value.unwrap());
                if opt.stop_after_positional_at > 0
                    && pos.len() >= opt.stop_after_positional_at
                {
                    let mut remaining_ = stream.iter.remain();
                    let first: &[u8] = if !remaining_.is_empty() {
                        // use bun.span due to the optimization for long strings
                        bun_core::span(remaining_[0])
                    } else {
                        b""
                    };
                    if !first.is_empty() && first == b"--" {
                        remaining_ = &remaining_[1..];
                    }

                    passthrough_positionals.reserve_exact(remaining_.len());
                    for arg_ in remaining_ {
                        // use bun.span due to the optimization for long strings
                        passthrough_positionals.push(bun_core::span(*arg_));
                        // PERF(port): was appendAssumeCapacity — profile in Phase B
                    }
                    break;
                }
            } else if param.takes_value == Values::One || param.takes_value == Values::OneOptional {
                debug_assert!(res.single_options.len() != 0);
                if res.single_options.len() != 0 {
                    res.single_options[param.id] = Some(arg.value.unwrap_or(b""));
                }
            } else if param.takes_value == Values::Many {
                debug_assert!(multis.len() != 0);
                if multis.len() != 0 {
                    multis[param.id].push(arg.value.unwrap());
                }
            } else {
                debug_assert!(res.flags.len() != 0);
                if res.flags.len() != 0 {
                    res.flags[param.id] = true;
                }
            }
        }

        for (i, multi) in multis.into_iter().enumerate() {
            res.multi_options[i] = multi.into_boxed_slice();
        }
        res.pos = pos.into_boxed_slice();
        res.passthrough_positionals = passthrough_positionals.into_boxed_slice();
        Ok(res)
    }

    // Zig `deinit` only freed `multi_options[*]` and `pos` (not `passthrough_positionals` —
    // likely a leak in the deprecated Zig). All are `Box<[..]>` here, so `Drop` handles it;
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
    // `converted_params` const. Rust takes `&self` to reach the slice; a Phase-B
    // proc-macro can restore the const-eval form.
    pub fn has_flag(&self, name: &[u8]) -> bool {
        for param in self.converted_params {
            if let Some(s) = param.names.short {
                // Zig: mem.eql(u8, name, "-" ++ [_]u8{s})
                if name.len() == 2 && name[0] == b'-' && name[1] == s {
                    return true;
                }
            }
            if let Some(l) = param.names.long {
                // Zig: mem.eql(u8, name, "--" ++ l)
                if name.strip_prefix(b"--") == Some(l) {
                    return true;
                }
            }
            // Check aliases
            for alias in param.names.long_aliases {
                if name.strip_prefix(b"--") == Some(alias) {
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
        for param in self.converted_params {
            if let Some(s) = param.names.short {
                if name.len() == 2 && name[0] == b'-' && name[1] == s {
                    return param;
                }
            }
            if let Some(l) = param.names.long {
                if name.strip_prefix(b"--") == Some(l) {
                    return param;
                }
            }
            // Check aliases
            for alias in param.names.long_aliases {
                if name.strip_prefix(b"--") == Some(alias) {
                    return param;
                }
            }
        }

        unreachable!("{} is not a parameter.", bstr::BStr::new(name));
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/clap/comptime.zig (199 lines)
//   confidence: medium
//   todos:      9
//   notes:      type-generator over comptime param slice; Phase B needs a proc-macro to derive FLAGS/SINGLE/MULTI + converted_params and restore compile-time name lookup
// ──────────────────────────────────────────────────────────────────────────
