//! SIMD JSON parser — strict RFC 8259.
//!
//! Both stages live in C++ (`highway_json.cpp`): stage 1 emits structural
//! indices; stage 2 walks them and writes a simdjson-style tape (`u64[]` of
//! `(tag<<56)|payload` words) plus a `string_buf` with every string body
//! pre-unescaped to UTF-8. One FFI call.
//!
//! This file walks the tape linearly to build `bun_ast::Expr`. Container child
//! counts are encoded in the start word so each `Vec` is sized exactly once.

use bun_alloc::{Arena as Bump, AstAlloc};
use bun_ast::{self as js_ast, E, Expr, ExprNodeList, G, Loc};
use bun_core::strings;
use bun_highway as hwy;
use hwy::json_tape as T;

/// Working buffers for one parse. Reusable across calls when parsing many
/// documents (npm registry responses, package.json scans).
#[derive(Default)]
pub struct SimdJSONBuffers {
    indices: Vec<u32>,
    tape: Vec<u64>,
}

impl SimdJSONBuffers {
    fn prepare(&mut self, len: usize) {
        let icap = len + 64 + 4;
        // Worst-case tape words per byte is 1.5 (`[[[...]]]` → 3 words per
        // 2 bytes) plus the root pair.
        let tcap = len + len / 2 + 8;
        macro_rules! ensure {
            ($v:expr, $cap:expr) => {
                if $v.capacity() < $cap {
                    $v.reserve($cap - $v.len());
                }
                // SAFETY: capacity ensured; POD elements; the C++ kernel
                // writes every slot it later reads, and we only read the
                // length-prefixed slice the kernel reports.
                #[allow(clippy::uninit_vec)]
                unsafe {
                    $v.set_len($cap)
                };
            };
        }
        ensure!(self.indices, icap);
        ensure!(self.tape, tcap);
    }
}

pub struct SimdJSON;

impl SimdJSON {
    pub fn parse<'a, 'bump: 'a>(
        source: &'a js_ast::Source,
        log: &'a mut js_ast::Log,
        bump: &'bump Bump,
    ) -> Result<Expr, bun_core::Error> {
        Self::parse_with_flags(source, log, bump, true).map(|(e, _)| e)
    }

    pub fn parse_with_flags<'a, 'bump: 'a>(
        source: &'a js_ast::Source,
        log: &'a mut js_ast::Log,
        bump: &'bump Bump,
        force_utf8: bool,
    ) -> Result<(Expr, bool), bun_core::Error> {
        let mut bufs = SimdJSONBuffers::default();
        Self::parse_into(&mut bufs, source, log, bump, force_utf8)
    }

    pub fn parse_into<'a, 'bump: 'a>(
        bufs: &mut SimdJSONBuffers,
        source: &'a js_ast::Source,
        log: &'a mut js_ast::Log,
        bump: &'bump Bump,
        force_utf8: bool,
    ) -> Result<(Expr, bool), bun_core::Error> {
        Expr::data_store_assert();
        js_ast::Stmt::data_store_assert();
        let _ = force_utf8; // strings are UTF-8 in string_buf already

        let src = &source.contents;
        let len = src.len();
        // Stage-1 emits u32 byte offsets; the tape encodes locs as u32. The
        // public entry points (`with_text_format_source`) already cap at
        // i32::MAX, but direct callers (sourcemap, npm) reach this without
        // that guard.
        if len > i32::MAX as usize {
            return fail(log, source, 0, hwy::JsonParseError::Capacity);
        }
        bufs.prepare(len);

        // strbuf lives in the bump arena so `E::String` can borrow directly
        // into it (same lifetime as the returned Expr) — eliminates the
        // per-string `mi_heap_malloc + memcpy` from `alloc_slice_copy`.
        // Uninitialised: the kernel writes `[0..strbuf_len)` (plus up to 32
        // speculative over-store bytes); we only ever read `[..strbuf_len]`.
        let strbuf_ptr = bump
            .alloc_layout(core::alloc::Layout::array::<u8>(len + 32).unwrap())
            .as_ptr();

        // SAFETY: `prepare` sized indices/tape per the kernel's contract;
        // the kernel reads exactly `src[..len]` (no padding required) and
        // writes at most `len+32` into `strbuf_ptr`.
        let (rc, out) = unsafe {
            hwy::json_parse(
                src.as_ptr(),
                len,
                bufs.indices.as_mut_ptr(),
                bufs.indices.len(),
                bufs.tape.as_mut_ptr(),
                strbuf_ptr,
            )
        };

        if rc != hwy::JsonParseError::Ok {
            return fail(log, source, out.err_pos, rc);
        }

        let tape = &bufs.tape[..out.tape_len as usize];
        // SAFETY: `[0..strbuf_len)` was fully written by the kernel; the
        // arena allocation lives for `'bump: 'a`.
        let strbuf: &[u8] =
            unsafe { core::slice::from_raw_parts(strbuf_ptr, out.strbuf_len as usize) };
        let mut w = TapeWalker {
            tape,
            strbuf,
            src,
            i: 1, // [0] is the root start word
            bump,
        };
        let root = w.value();
        debug_assert_eq!(w.i, tape.len().saturating_sub(1)); // root end word

        let is_ascii_only = !out.flags.contains(hwy::JsonIndexFlags::NON_ASCII)
            && strings::first_non_ascii(strbuf).is_none();
        Ok((root, is_ascii_only))
    }
}

struct TapeWalker<'a, 't, 'bump> {
    tape: &'t [u64],
    strbuf: &'a [u8],
    src: &'a [u8],
    i: usize,
    bump: &'bump Bump,
}

#[inline]
fn loc32(p: u64) -> Loc {
    js_ast::usize2loc((p & 0xFFFF_FFFF) as usize)
}

impl<'a, 't, 'bump> TapeWalker<'a, 't, 'bump> {
    /// `Expr::allocate` — bypasses the `Store::append` TLS lookup since we
    /// already hold the arena.
    #[inline(always)]
    fn expr<Ty: js_ast::IntoExprData>(&self, t: Ty, l: Loc) -> Expr {
        Expr::allocate(self.bump, t, l)
    }

    #[inline(always)]
    fn next(&mut self) -> u64 {
        let w = self.tape[self.i];
        self.i += 1;
        w
    }

    #[inline(always)]
    fn read_string(&mut self, w: u64) -> (E::String, Loc) {
        const BORROWED: u64 = 1 << 55;
        let p = T::payload(w);
        let off = (p & (BORROWED - 1)) as usize;
        let extra = self.next();
        let len = (extra >> 32) as usize;
        let l = loc32(extra);
        // Both arms borrow with lifetime `'a`: source for escape-free bodies,
        // bump-arena `strbuf` for unescaped bodies.
        let body: &'a [u8] = if p & BORROWED != 0 {
            &self.src[off..off + len]
        } else {
            &self.strbuf[off..off + len]
        };
        (E::String::init(body), l)
    }

    #[inline(always)]
    fn read_property(&mut self) -> G::Property {
        let kw = self.next();
        debug_assert_eq!(T::tag(kw), T::STR);
        let (ks, kl) = self.read_string(kw);
        let key = self.expr(ks, kl);
        let val = self.value();
        G::Property {
            key: Some(key),
            value: Some(val),
            kind: js_ast::G::PropertyKind::Normal,
            ..Default::default()
        }
    }

    fn value(&mut self) -> Expr {
        let w = self.next();
        match T::tag(w) {
            T::STR => {
                let (s, l) = self.read_string(w);
                self.expr(s, l)
            }
            T::DBL => {
                let l = loc32(T::payload(w));
                let bits = self.next();
                self.expr(E::Number::new(f64::from_bits(bits)), l)
            }
            T::TRUE => self.expr(E::Boolean { value: true }, loc32(T::payload(w))),
            T::FALSE => self.expr(E::Boolean { value: false }, loc32(T::payload(w))),
            T::NULL => self.expr(E::Null {}, loc32(T::payload(w))),
            T::START_ARR => {
                let count = (T::payload(w) >> 32) as usize;
                let l = loc32(self.next());
                // Allocate directly with `AstAlloc` so the result IS an
                // `ExprNodeList` — no `move_from_list` realloc + memcpy.
                // `count` is a 24-bit hint (saturates past 16M); iterate until
                // END_ARR so larger arrays remain correct, and `push` after
                // the hinted prefix is full.
                let mut items: ExprNodeList = AstAlloc::vec_with_capacity(count);
                let dst = items.spare_capacity_mut();
                let mut filled = 0;
                while filled < count {
                    dst[filled].write(self.value());
                    filled += 1;
                }
                // SAFETY: `[0, count)` fully written; capacity reserved.
                unsafe { items.set_len(count) };
                while T::tag(self.tape[self.i]) != T::END_ARR {
                    items.push(self.value());
                }
                self.i += 1;
                self.expr(
                    E::Array {
                        items,
                        is_single_line: true,
                        ..Default::default()
                    },
                    l,
                )
            }
            T::START_OBJ => {
                let count = (T::payload(w) >> 32) as usize;
                let l = loc32(self.next());
                let mut props: G::PropertyList = AstAlloc::vec_with_capacity(count);
                let dst = props.spare_capacity_mut();
                let mut filled = 0;
                while filled < count {
                    dst[filled].write(self.read_property());
                    filled += 1;
                }
                // SAFETY: `[0, count)` fully written; capacity reserved.
                unsafe { props.set_len(count) };
                while T::tag(self.tape[self.i]) != T::END_OBJ {
                    props.push(self.read_property());
                }
                self.i += 1;
                self.expr(
                    E::Object {
                        properties: props,
                        is_single_line: true,
                        ..Default::default()
                    },
                    l,
                )
            }
            // ROOT/END_* are handled by callers; reaching them here is a bug.
            t => unreachable!("unexpected tape tag {}", t as char),
        }
    }
}

#[cold]
fn fail<T>(
    log: &mut js_ast::Log,
    source: &js_ast::Source,
    pos: u32,
    rc: hwy::JsonParseError,
) -> Result<T, bun_core::Error> {
    let msg: &'static [u8] = match rc {
        hwy::JsonParseError::UnclosedString => b"Unterminated string literal",
        hwy::JsonParseError::UnescapedCtrl => b"Unescaped control character in string literal",
        hwy::JsonParseError::Empty => b"Unexpected end of file",
        hwy::JsonParseError::DepthExceeded => b"JSON nesting too deep",
        hwy::JsonParseError::Number => b"Invalid number literal",
        hwy::JsonParseError::Atom => b"Invalid JSON value",
        hwy::JsonParseError::StringEscape => b"Invalid escape sequence",
        hwy::JsonParseError::Trailing => b"Unexpected token after end of JSON value",
        hwy::JsonParseError::Tape => b"Unexpected token",
        hwy::JsonParseError::Utf8 => b"Invalid UTF-8 in string literal",
        hwy::JsonParseError::Capacity | hwy::JsonParseError::Ok => b"JSON parse error",
    };
    let r = js_ast::Range {
        loc: js_ast::usize2loc((pos as usize).min(source.contents.len())),
        len: 1,
    };
    log.add_range_error(Some(source), r, msg);
    Err(bun_core::err!("ParserError"))
}
