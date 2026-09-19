//! `long double` on x86-64 is the 80-bit x87 format, and nothing else in the compiler or the
//! backend knows the x87 unit exists. So a `long double` is always in memory (16 bytes, 16-byte
//! aligned) and each operation on one is a fixed instruction sequence that works on addresses:
//! it loads its operands onto the x87 stack, computes, stores the result, and leaves the stack as
//! it found it. The sequences go out through the `InlineAsm` instruction, like an `asm` statement.
//!
//! Each was checked against the host compiler's own `long double` arithmetic on a grid of values
//! that includes infinities, a NaN and values far outside `double`'s range.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum X87Op {
    /// `(dst, a, b)`: `*dst = *a op *b`.
    Add,
    Sub,
    Mul,
    Div,
    /// `(dst, a)`: `*dst = -*a`.
    Neg,
    /// `(a, b)` -> `int`: `*a < *b`, `*a <= *b`, `*a == *b`. False when either is a NaN.
    Less,
    LessEq,
    Equal,
    /// `(dst, src)`: `*dst` from the `double`, `float` or `int64_t` at `src`.
    FromF64,
    FromF32,
    FromI64,
    /// `(dst, src, addend)`: from the `uint64_t` at `src`, read as signed, plus the `float` at
    /// `addend`: 0 when the top bit was clear, 2^64 when it was set. Exact either way.
    FromI64Plus,
    /// `(dst, a)`: the `double`, `float` or (truncated toward zero) `int64_t` at `dst` from `*a`.
    ToF64,
    ToF32,
    ToI64,
    /// `(a)`: puts `*a` where a function returns a `long double`. Nothing may come between this
    /// and the return.
    LoadReturn,
    /// `(dst)`: takes what a function just returned in that place. Must directly follow the call.
    StoreResult,
}

pub(crate) struct Sequence {
    pub(crate) code: &'static [u8],
    /// The register each operand's address goes in (BIR numbering: 7 = rdi, 6 = rsi, 2 = rdx).
    pub(crate) registers: &'static [u8],
    /// For the comparisons: the `int` result comes back in rax; rcx is used on the way.
    pub(crate) result_in_rax: bool,
    pub(crate) clobbers: &'static [u8],
}

const RDI: u8 = 7;
const RSI: u8 = 6;
const RDX: u8 = 2;
const RCX: u8 = 1;

impl X87Op {
    pub(crate) fn sequence(self) -> Sequence {
        // fld m80 = DB /5, fstp m80 = DB /7, with (%rsi) = 2E/3E, (%rdx) = 2A, (%rdi) = 2F/3F.
        let plain = |code: &'static [u8], registers: &'static [u8]| Sequence {
            code,
            registers,
            result_in_rax: false,
            clobbers: &[],
        };
        // fld a; fld b; fucomip compares st0 (b) with st1 (a); fstp st0 drops a; then the
        // condition: b > a (seta), b >= a (setae), or equal and ordered (sete & setnp).
        let compare = |code: &'static [u8]| Sequence {
            code,
            registers: &[RSI, RDX],
            result_in_rax: true,
            clobbers: &[RCX],
        };
        match self {
            X87Op::Add => plain(
                &[0xdb, 0x2e, 0xdb, 0x2a, 0xde, 0xc1, 0xdb, 0x3f],
                &[RDI, RSI, RDX],
            ),
            X87Op::Sub => plain(
                &[0xdb, 0x2e, 0xdb, 0x2a, 0xde, 0xe9, 0xdb, 0x3f],
                &[RDI, RSI, RDX],
            ),
            X87Op::Mul => plain(
                &[0xdb, 0x2e, 0xdb, 0x2a, 0xde, 0xc9, 0xdb, 0x3f],
                &[RDI, RSI, RDX],
            ),
            X87Op::Div => plain(
                &[0xdb, 0x2e, 0xdb, 0x2a, 0xde, 0xf9, 0xdb, 0x3f],
                &[RDI, RSI, RDX],
            ),
            X87Op::Neg => plain(&[0xdb, 0x2e, 0xd9, 0xe0, 0xdb, 0x3f], &[RDI, RSI]),
            X87Op::Less => compare(&[
                0xdb, 0x2e, 0xdb, 0x2a, 0xdf, 0xe9, 0xdd, 0xd8, 0x0f, 0x97, 0xc0, 0x0f, 0xb6, 0xc0,
            ]),
            X87Op::LessEq => compare(&[
                0xdb, 0x2e, 0xdb, 0x2a, 0xdf, 0xe9, 0xdd, 0xd8, 0x0f, 0x93, 0xc0, 0x0f, 0xb6, 0xc0,
            ]),
            X87Op::Equal => compare(&[
                0xdb, 0x2e, 0xdb, 0x2a, 0xdf, 0xe9, 0xdd, 0xd8, 0x0f, 0x94, 0xc0, 0x0f, 0x9b, 0xc1,
                0x20, 0xc8, 0x0f, 0xb6, 0xc0,
            ]),
            X87Op::FromF64 => plain(&[0xdd, 0x06, 0xdb, 0x3f], &[RDI, RSI]),
            X87Op::FromF32 => plain(&[0xd9, 0x06, 0xdb, 0x3f], &[RDI, RSI]),
            X87Op::FromI64 => plain(&[0xdf, 0x2e, 0xdb, 0x3f], &[RDI, RSI]),
            X87Op::FromI64Plus => plain(&[0xdf, 0x2e, 0xd8, 0x02, 0xdb, 0x3f], &[RDI, RSI, RDX]),
            X87Op::ToF64 => plain(&[0xdb, 0x2e, 0xdd, 0x1f], &[RDI, RSI]),
            X87Op::ToF32 => plain(&[0xdb, 0x2e, 0xd9, 0x1f], &[RDI, RSI]),
            // fisttp (DD /1) truncates whatever the rounding mode is.
            X87Op::ToI64 => plain(&[0xdb, 0x2e, 0xdd, 0x0f], &[RDI, RSI]),
            X87Op::LoadReturn => plain(&[0xdb, 0x2e], &[RSI]),
            X87Op::StoreResult => plain(&[0xdb, 0x3f], &[RDI]),
        }
    }

    pub(crate) fn operand_count(self) -> usize {
        self.sequence().registers.len()
    }
}
