//! Evaluation of `#if` / `#elif` controlling expressions (C11 6.10.1).
//!
//! The line is macro-expanded lazily so that the operands of `defined` and the
//! `__has_*` operators are read unexpanded, then parsed with intmax_t/uintmax_t arithmetic.

use crate::pp::{PTok, Preprocessor};
use crate::token::{Loc, PpKind, PpToken, Punct, Res, Tok, classify, display_bytes, err};

#[derive(Clone, Copy)]
struct Value {
    bits: i64,
    unsigned: bool,
}

impl Value {
    fn signed(v: i64) -> Value {
        Value {
            bits: v,
            unsigned: false,
        }
    }

    fn truth(self) -> bool {
        self.bits != 0
    }
}

/// The builtins there are, apart from the C library's functions under their `__builtin_` names
/// (see `has_builtin`). `__has_builtin` answers from this, and the parser takes no builtin that
/// is not here, so the two cannot come to disagree.
const SUPPORTED_BUILTINS: &[&str] = &[
    "__builtin_expect",
    "__builtin_expect_with_probability",
    "__builtin_prefetch",
    "__builtin_isnan",
    "__builtin_isinf",
    "__builtin_isinf_sign",
    "__builtin_isfinite",
    "__builtin_isnormal",
    "__builtin_signbit",
    "__builtin_signbitf",
    "__builtin_signbitl",
    "__builtin_fpclassify",
    "__builtin_isgreater",
    "__builtin_isgreaterequal",
    "__builtin_isless",
    "__builtin_islessequal",
    "__builtin_islessgreater",
    "__builtin_isunordered",
    "__builtin_fabs",
    "__builtin_fabsf",
    "__builtin_copysign",
    "__builtin_copysignf",
    "__builtin_fabsl",
    "__builtin_copysignl",
    "__builtin_clrsb",
    "__builtin_clrsbl",
    "__builtin_clrsbll",
    "__builtin_bitreverse8",
    "__builtin_bitreverse16",
    "__builtin_bitreverse32",
    "__builtin_bitreverse64",
    "__builtin_huge_val",
    "__builtin_huge_valf",
    "__builtin_inf",
    "__builtin_inff",
    "__builtin_nan",
    "__builtin_nanf",
    "__builtin_huge_vall",
    "__builtin_infl",
    "__builtin_nanl",
    "__builtin_sqrt",
    "__builtin_sqrtf",
    "__builtin_floor",
    "__builtin_floorf",
    "__builtin_ceil",
    "__builtin_ceilf",
    "__builtin_trunc",
    "__builtin_truncf",
    "__builtin_round",
    "__builtin_roundf",
    "__builtin_rint",
    "__builtin_rintf",
    "__builtin_nearbyint",
    "__builtin_nearbyintf",
    "__builtin_fma",
    "__builtin_fmaf",
    "__builtin_fmax",
    "__builtin_fmaxf",
    "__builtin_fmin",
    "__builtin_fminf",
    "__builtin_memcpy",
    "__builtin_memmove",
    "__builtin_memset",
    "__builtin_memcmp",
    "__builtin_memchr",
    "__builtin_strlen",
    "__builtin_strcmp",
    "__builtin_strncmp",
    "__builtin_strchr",
    "__builtin_strrchr",
    "__builtin_abs",
    "__builtin_labs",
    "__builtin_llabs",
    "__builtin_abort",
    "__builtin_malloc",
    "__builtin_free",
    "__builtin_frame_address",
    "__builtin_return_address",
    "__builtin_extract_return_addr",
    "__builtin_assume_aligned",
    "__builtin_object_size",
    "__builtin_dynamic_object_size",
    "__builtin_choose_expr",
    "__builtin_cpu_init",
    "__builtin_cpu_supports",
    "__builtin_add_overflow",
    "__builtin_sub_overflow",
    "__builtin_mul_overflow",
    "__builtin_sadd_overflow",
    "__builtin_saddl_overflow",
    "__builtin_saddll_overflow",
    "__builtin_uadd_overflow",
    "__builtin_uaddl_overflow",
    "__builtin_uaddll_overflow",
    "__builtin_ssub_overflow",
    "__builtin_ssubl_overflow",
    "__builtin_ssubll_overflow",
    "__builtin_usub_overflow",
    "__builtin_usubl_overflow",
    "__builtin_usubll_overflow",
    "__builtin_smul_overflow",
    "__builtin_smull_overflow",
    "__builtin_smulll_overflow",
    "__builtin_umul_overflow",
    "__builtin_umull_overflow",
    "__builtin_umulll_overflow",
    "__builtin_rotateleft8",
    "__builtin_rotateleft16",
    "__builtin_rotateleft32",
    "__builtin_rotateleft64",
    "__builtin_rotateright8",
    "__builtin_rotateright16",
    "__builtin_rotateright32",
    "__builtin_rotateright64",
    "__builtin_ffs",
    "__builtin_ffsl",
    "__builtin_ffsll",
    "__builtin_parity",
    "__builtin_parityl",
    "__builtin_parityll",
    "__builtin_offsetof",
    "__builtin_constant_p",
    "__builtin_unreachable",
    "__builtin_trap",
    "__builtin_bswap16",
    "__builtin_bswap32",
    "__builtin_bswap64",
    "__builtin_clz",
    "__builtin_clzl",
    "__builtin_clzll",
    "__builtin_ctz",
    "__builtin_ctzl",
    "__builtin_ctzll",
    "__builtin_popcount",
    "__builtin_popcountl",
    "__builtin_popcountll",
    "__builtin_types_compatible_p",
    "__builtin_va_start",
    "__builtin_va_arg",
    "__builtin_va_end",
    "__builtin_va_copy",
    "__builtin_alloca",
    "__builtin_alloca_with_align",
    "__builtin_shufflevector",
    "__builtin_shuffle",
    "__builtin_convertvector",
    "__builtin_elementwise_abs",
    "__builtin_elementwise_min",
    "__builtin_elementwise_max",
    "__builtin_elementwise_minimum",
    "__builtin_elementwise_maximum",
    "__builtin_reduce_minimum",
    "__builtin_reduce_maximum",
    "__builtin_elementwise_sqrt",
    "__builtin_elementwise_add_sat",
    "__builtin_elementwise_sub_sat",
    "__builtin_reduce_add",
    "__builtin_reduce_mul",
    "__builtin_reduce_min",
    "__builtin_reduce_max",
    "__builtin_reduce_and",
    "__builtin_reduce_or",
    "__builtin_reduce_xor",
    "__atomic_load_n",
    "__atomic_store_n",
    "__atomic_exchange_n",
    "__atomic_compare_exchange_n",
    "__atomic_load",
    "__atomic_store",
    "__atomic_exchange",
    "__atomic_compare_exchange",
    "__atomic_fetch_add",
    "__atomic_fetch_sub",
    "__atomic_fetch_and",
    "__atomic_fetch_or",
    "__atomic_fetch_xor",
    "__atomic_fetch_nand",
    "__atomic_add_fetch",
    "__atomic_sub_fetch",
    "__atomic_and_fetch",
    "__atomic_or_fetch",
    "__atomic_xor_fetch",
    "__atomic_nand_fetch",
    "__atomic_test_and_set",
    "__atomic_clear",
    "__atomic_thread_fence",
    "__atomic_signal_fence",
    "__atomic_always_lock_free",
    "__atomic_is_lock_free",
    "__sync_fetch_and_add",
    "__sync_fetch_and_sub",
    "__sync_fetch_and_or",
    "__sync_fetch_and_and",
    "__sync_fetch_and_xor",
    "__sync_fetch_and_nand",
    "__sync_add_and_fetch",
    "__sync_sub_and_fetch",
    "__sync_or_and_fetch",
    "__sync_and_and_fetch",
    "__sync_xor_and_fetch",
    "__sync_nand_and_fetch",
    "__sync_bool_compare_and_swap",
    "__sync_val_compare_and_swap",
    "__sync_lock_test_and_set",
    "__sync_lock_release",
    "__sync_synchronize",
    "__builtin_assume",
    "__builtin_bir_average_u16",
    "__builtin_bir_average_u8",
    "__builtin_bir_swizzle",
    "__builtin_bun_unsupported",
    "__builtin_complex",
    "__builtin_cpu_is",
    "__builtin_finite",
    "__builtin_finitef",
    "__builtin_finitel",
    "__builtin_frob_return_addr",
    "__builtin_ia32_cvtdq2pd",
    "__builtin_ia32_cvtpd2ps",
    "__builtin_ia32_cvtps2pd",
    "__builtin_ia32_cvttpd2dq",
    "__builtin_ia32_movmskpd",
    "__builtin_ia32_movmskps",
    "__builtin_ia32_packssdw128",
    "__builtin_ia32_packsswb128",
    "__builtin_ia32_packusdw128",
    "__builtin_ia32_packuswb128",
    "__builtin_ia32_paddsb128",
    "__builtin_ia32_paddsw128",
    "__builtin_ia32_paddusb128",
    "__builtin_ia32_paddusw128",
    "__builtin_ia32_pavgb128",
    "__builtin_ia32_pavgw128",
    "__builtin_ia32_pmaddwd128",
    "__builtin_ia32_pmovmskb128",
    "__builtin_ia32_pmovsxbw128",
    "__builtin_ia32_pmovsxdq128",
    "__builtin_ia32_pmovsxwd128",
    "__builtin_ia32_pmovzxbw128",
    "__builtin_ia32_pmovzxdq128",
    "__builtin_ia32_pmovzxwd128",
    "__builtin_ia32_pmulhuw128",
    "__builtin_ia32_pmulhw128",
    "__builtin_ia32_psubsb128",
    "__builtin_ia32_psubsw128",
    "__builtin_ia32_psubusb128",
    "__builtin_ia32_psubusw128",
    "__builtin_ia32_ptestz128",
    "__builtin_isinff",
    "__builtin_isinfl",
    "__builtin_isnanf",
    "__builtin_isnanl",
    "__builtin_nans",
    "__builtin_nansf",
    "__builtin_nansl",
    "__builtin_unpredictable",
    "__c11_atomic_compare_exchange_strong",
    "__c11_atomic_compare_exchange_weak",
    "__c11_atomic_exchange",
    "__c11_atomic_init",
    "__c11_atomic_is_lock_free",
    "__c11_atomic_load",
    "__c11_atomic_signal_fence",
    "__c11_atomic_store",
    "__c11_atomic_thread_fence",
    "__atomic_fetch_max",
    "__atomic_fetch_min",
    "__atomic_max_fetch",
    "__atomic_min_fetch",
    "__builtin___clear_cache",
    "__builtin_bir_extmul_high_s16",
    "__builtin_bir_extmul_high_s32",
    "__builtin_bir_extmul_high_s8",
    "__builtin_bir_extmul_high_u16",
    "__builtin_bir_extmul_high_u32",
    "__builtin_bir_extmul_high_u8",
    "__builtin_bir_extmul_low_s16",
    "__builtin_bir_extmul_low_s32",
    "__builtin_bir_extmul_low_s8",
    "__builtin_bir_extmul_low_u16",
    "__builtin_bir_extmul_low_u32",
    "__builtin_bir_extmul_low_u8",
    "__c11_atomic_fetch_add",
    "__c11_atomic_fetch_and",
    "__c11_atomic_fetch_max",
    "__c11_atomic_fetch_min",
    "__c11_atomic_fetch_nand",
    "__c11_atomic_fetch_or",
    "__c11_atomic_fetch_sub",
    "__c11_atomic_fetch_xor",
    "__sync_fetch_and_max",
    "__sync_fetch_and_min",
    "__sync_max_and_fetch",
    "__sync_min_and_fetch",
];

/// Whether `name` is a builtin of this compiler for `target`.
pub(crate) fn has_builtin(name: &str, target: crate::types::Target) -> bool {
    SUPPORTED_BUILTINS.contains(&name)
        || name
            .strip_prefix("__builtin_")
            .is_some_and(|function| crate::parser::is_library_builtin(function, target))
}

struct ExprParser<'t> {
    tokens: &'t [PpToken],
    pos: usize,
    loc: Loc,
    dialect: crate::token::Dialect,
    /// Parentheses and `?:` middle operands around the current position.
    nesting: u32,
    stack_check: &'t bun_core::StackCheck,
    /// Windows, whose `wchar_t` is an unsigned 16-bit type; elsewhere it is `int`.
    wchar_is_16_bits: bool,
}

/// What an `#if` expression may nest (C11 5.2.4.1 asks for 63 levels of parentheses).
const MAX_NESTING: u32 = 500;

impl Preprocessor {
    pub(crate) fn eval_condition(&mut self, line: Vec<PpToken>, loc: Loc) -> Res<bool> {
        if line.is_empty() {
            return err(loc, "#if with no expression");
        }
        let input: Vec<PTok> = line.into_iter().map(PTok::plain).collect();
        let tokens = self.with_isolated_input(input, |pp| {
            let mut out: Vec<PpToken> = Vec::new();
            loop {
                let t = pp.next_expanded()?;
                if t.is_eof() {
                    return Ok(out);
                }
                let operator = match t.ident() {
                    Some(name) if name == b"defined" || name.starts_with(b"__has_") => {
                        Some(name.to_vec())
                    }
                    _ => None,
                };
                let Some(operator) = operator else {
                    out.push(t.tok);
                    continue;
                };
                let value = pp.pp_operator(&operator, t.tok.loc)?;
                let Some(value) = value else {
                    out.push(t.tok);
                    continue;
                };
                out.push(PpToken {
                    kind: PpKind::Number,
                    text: vec![if value { b'1' } else { b'0' }],
                    ..t.tok
                });
            }
        })?;
        let mut parser = ExprParser {
            tokens: &tokens,
            pos: 0,
            loc,
            dialect: self.target.dialect(),
            nesting: 0,
            stack_check: &self.stack_check,
            wchar_is_16_bits: self.target.os == crate::types::Os::Windows,
        };
        let value = parser.conditional(true)?;
        if let Some(extra) = parser.tokens.get(parser.pos) {
            return err(
                extra.loc,
                "missing binary operator in preprocessor expression",
            );
        }
        Ok(value.truth())
    }

    /// Evaluates `defined X`, `defined(X)` or a `__has_*(...)` operator whose name was just
    /// read; its operands are taken unexpanded. `None` if `name` is not such an operator.
    fn pp_operator(&mut self, name: &[u8], loc: Loc) -> Res<Option<bool>> {
        if name == b"defined" {
            let mut t = self.next_raw()?;
            let parenthesized = t.is_punct(Punct::LParen);
            if parenthesized {
                t = self.next_raw()?;
            }
            let Some(operand) = t.ident().map(<[u8]>::to_vec) else {
                return err(loc, "operator 'defined' requires an identifier");
            };
            if parenthesized && !self.next_raw()?.is_punct(Punct::RParen) {
                return err(loc, "missing ')' after 'defined'");
            }
            return Ok(Some(self.is_defined(&operand)));
        }
        let known = crate::pp::is_pp_operator(name) || name == b"__has_warning";
        if !known {
            return Ok(None);
        }
        let open = self.next_raw()?;
        if !open.is_punct(Punct::LParen) {
            return err(loc, format!("missing '(' after '{}'", display_bytes(name)));
        }
        let mut operand: Vec<PpToken> = Vec::new();
        let mut depth = 0;
        loop {
            let t = self.next_raw()?;
            if t.is_eof() {
                return err(loc, format!("missing ')' after '{}'", display_bytes(name)));
            }
            if t.is_punct(Punct::LParen) {
                depth += 1;
            } else if t.is_punct(Punct::RParen) {
                if depth == 0 {
                    break;
                }
                depth -= 1;
            }
            operand.push(t.tok);
        }
        Ok(Some(match name {
            b"__has_include" | b"__has_include_next" => {
                // Anything but "name" or <name> is macro-expanded first, as in #include.
                let direct = matches!(operand.as_slice(), [t] if t.kind == PpKind::StrLit)
                    || operand
                        .first()
                        .is_some_and(|t| t.kind == PpKind::Punct(Punct::Lt));
                let operand = if direct {
                    operand
                } else {
                    let tokens: Vec<crate::pp::PTok> =
                        operand.into_iter().map(crate::pp::PTok::plain).collect();
                    self.with_isolated_input(tokens, |pp| {
                        let mut out = Vec::new();
                        loop {
                            let t = pp.next_expanded()?;
                            if t.is_eof() {
                                return Ok(out);
                            }
                            out.push(t.for_header_name());
                        }
                    })?
                };
                let (header, form) = Self::header_name_from_tokens(&operand, loc)?;
                let search = if name == b"__has_include_next" {
                    crate::pp_directive::SearchFrom::AfterThisFile
                } else {
                    crate::pp_directive::SearchFrom::TheStart
                };
                self.resolve_include(&header, form, search).is_some()
            }
            b"__has_attribute" => match operand.as_slice() {
                [t] if t.kind == PpKind::Ident => crate::parser::has_attribute(&t.text),
                _ => false,
            },
            b"__has_builtin" => match operand.as_slice() {
                [t] if t.kind == PpKind::Ident => {
                    std::str::from_utf8(&t.text).is_ok_and(|name| has_builtin(name, self.target))
                }
                _ => false,
            },
            _ => false,
        }))
    }
}

impl ExprParser<'_> {
    fn peek_punct(&self) -> Option<Punct> {
        match self.tokens.get(self.pos)?.kind {
            PpKind::Punct(p) => Some(p),
            _ => None,
        }
    }

    fn eat(&mut self, p: Punct) -> bool {
        if self.peek_punct() == Some(p) {
            self.pos += 1;
            return true;
        }
        false
    }

    fn here(&self) -> Loc {
        self.tokens.get(self.pos).map_or(self.loc, |t| t.loc)
    }

    /// Runs `inner` one level deeper: inside parentheses, or between `?` and `:`.
    fn nested(&mut self, inner: impl FnOnce(&mut Self) -> Res<Value>) -> Res<Value> {
        self.nesting += 1;
        if self.nesting > MAX_NESTING || !self.stack_check.is_safe_to_recurse() {
            return err(self.here(), "preprocessor expression is nested too deeply");
        }
        let v = inner(self);
        self.nesting -= 1;
        v
    }

    /// `live` is false in the unevaluated arm of `&&`, `||` and `?:`.
    fn conditional(&mut self, mut live: bool) -> Res<Value> {
        // `a ? b : c ? d : e` is a chain, which a loop follows; only `b` and `d` nest.
        let mut chosen = None;
        let mut unsigned = false;
        loop {
            let cond = self.binary(1, live)?;
            if !self.eat(Punct::Question) {
                return Ok(Value {
                    bits: chosen.unwrap_or(cond.bits),
                    unsigned: unsigned || cond.unsigned,
                });
            }
            let then = self.nested(|p| p.conditional(live && cond.truth()))?;
            if !self.eat(Punct::Colon) {
                return err(self.here(), "expected ':' in preprocessor expression");
            }
            unsigned |= then.unsigned;
            if chosen.is_none() && cond.truth() {
                chosen = Some(then.bits);
            }
            live = live && !cond.truth();
        }
    }

    fn binary(&mut self, min_prec: u32, live: bool) -> Res<Value> {
        let mut lhs = self.unary(live)?;
        loop {
            let Some(op) = self.peek_punct() else {
                return Ok(lhs);
            };
            let prec = match op {
                Punct::PipePipe => 1,
                Punct::AmpAmp => 2,
                Punct::Pipe => 3,
                Punct::Caret => 4,
                Punct::Amp => 5,
                Punct::EqEq | Punct::Ne => 6,
                Punct::Lt | Punct::Gt | Punct::Le | Punct::Ge => 7,
                Punct::Shl | Punct::Shr => 8,
                Punct::Plus | Punct::Minus => 9,
                Punct::Star | Punct::Slash | Punct::Percent => 10,
                _ => return Ok(lhs),
            };
            if prec < min_prec {
                return Ok(lhs);
            }
            let op_loc = self.here();
            self.pos += 1;
            let rhs_live = match op {
                Punct::AmpAmp => live && lhs.truth(),
                Punct::PipePipe => live && !lhs.truth(),
                _ => live,
            };
            let rhs = self.binary(prec + 1, rhs_live)?;
            lhs = apply(op, lhs, rhs, rhs_live, op_loc)?;
        }
    }

    fn unary(&mut self, live: bool) -> Res<Value> {
        // A run of prefix operators is applied from the inside out once its operand is known.
        let mut prefix = Vec::new();
        let mut v = loop {
            let loc = self.here();
            let Some(tok) = self.tokens.get(self.pos) else {
                return err(loc, "expected a value in preprocessor expression");
            };
            self.pos += 1;
            match tok.kind {
                PpKind::Punct(op @ (Punct::Plus | Punct::Minus | Punct::Tilde | Punct::Bang)) => {
                    prefix.push(op)
                }
                _ => break self.primary(tok, loc, live)?,
            }
        };
        for op in prefix.into_iter().rev() {
            v = match op {
                Punct::Minus => Value {
                    bits: v.bits.wrapping_neg(),
                    unsigned: v.unsigned,
                },
                Punct::Tilde => Value {
                    bits: !v.bits,
                    unsigned: v.unsigned,
                },
                Punct::Bang => Value::signed(i64::from(!v.truth())),
                _ => v,
            };
        }
        Ok(v)
    }

    fn primary(&mut self, tok: &PpToken, loc: Loc, live: bool) -> Res<Value> {
        match tok.kind {
            PpKind::Punct(Punct::LParen) => {
                let v = self.nested(|p| p.comma(live))?;
                if !self.eat(Punct::RParen) {
                    return err(self.here(), "missing ')' in preprocessor expression");
                }
                Ok(v)
            }
            PpKind::Ident => {
                // Identifiers that survive expansion are 0: `true` and `false` too, which before
                // C23 are macros of <stdbool.h> and nothing else.
                // In a dead arm, tolerate `UNDEFINED_MACRO(args)`.
                if !live && self.peek_punct() == Some(Punct::LParen) {
                    let mut depth = 0;
                    while let Some(t) = self.tokens.get(self.pos) {
                        self.pos += 1;
                        match t.kind {
                            PpKind::Punct(Punct::LParen) => depth += 1,
                            PpKind::Punct(Punct::RParen) => {
                                depth -= 1;
                                if depth == 0 {
                                    break;
                                }
                            }
                            _ => {}
                        }
                    }
                }
                Ok(Value::signed(0))
            }
            PpKind::Number | PpKind::CharLit => {
                match classify(tok, self.dialect, &mut Vec::new())?.tok {
                    Tok::Int { value, suffix, .. } => {
                        let unsigned = suffix.unsigned || (value > i64::MAX as u64);
                        Ok(Value {
                            bits: value as i64,
                            unsigned,
                        })
                    }
                    Tok::Char(v) => Ok(Value::signed(v)),
                    // A wide constant has the value it has in the target's `wchar_t`,
                    // `char16_t` or `char32_t` (C11 6.10.1p4).
                    Tok::WideChar(kind, v) => Ok(match kind {
                        crate::token::WideKind::Wchar if !self.wchar_is_16_bits => {
                            Value::signed(i64::from(v as i32))
                        }
                        crate::token::WideKind::Wchar | crate::token::WideKind::Char16 => Value {
                            bits: i64::from(v as u16),
                            unsigned: true,
                        },
                        crate::token::WideKind::Char32 => Value {
                            bits: i64::from(v),
                            unsigned: true,
                        },
                    }),
                    Tok::NotANumber(message) => err(loc, message.to_string()),
                    _ => err(loc, "floating constant in preprocessor expression"),
                }
            }
            _ => err(
                loc,
                format!(
                    "token \"{}\" is not valid in preprocessor expressions",
                    display_bytes(crate::pp::spelling(tok))
                ),
            ),
        }
    }

    fn comma(&mut self, live: bool) -> Res<Value> {
        let mut v = self.conditional(live)?;
        while self.eat(Punct::Comma) {
            v = self.conditional(live)?;
        }
        Ok(v)
    }
}

fn apply(op: Punct, a: Value, b: Value, live: bool, loc: Loc) -> Res<Value> {
    let unsigned = a.unsigned || b.unsigned;
    let (x, y) = (a.bits, b.bits);
    let (ux, uy) = (x as u64, y as u64);
    let arith = |bits: i64| Value { bits, unsigned };
    let boolean = |v: bool| Value::signed(i64::from(v));
    Ok(match op {
        Punct::PipePipe => boolean(a.truth() || b.truth()),
        Punct::AmpAmp => boolean(a.truth() && b.truth()),
        Punct::Pipe => arith(x | y),
        Punct::Caret => arith(x ^ y),
        Punct::Amp => arith(x & y),
        Punct::EqEq => boolean(x == y),
        Punct::Ne => boolean(x != y),
        Punct::Lt => boolean(if unsigned { ux < uy } else { x < y }),
        Punct::Gt => boolean(if unsigned { ux > uy } else { x > y }),
        Punct::Le => boolean(if unsigned { ux <= uy } else { x <= y }),
        Punct::Ge => boolean(if unsigned { ux >= uy } else { x >= y }),
        Punct::Shl | Punct::Shr => {
            // The result has the type of the left operand; a negative count shifts the other way.
            let left = (op == Punct::Shl) == (b.unsigned || y >= 0);
            let count = if b.unsigned { uy } else { y.unsigned_abs() };
            let bits = if count >= 64 {
                if left || a.unsigned || x >= 0 { 0 } else { -1 }
            } else if left {
                (ux << count) as i64
            } else if a.unsigned {
                (ux >> count) as i64
            } else {
                x >> count
            };
            Value {
                bits,
                unsigned: a.unsigned,
            }
        }
        Punct::Plus => arith(x.wrapping_add(y)),
        Punct::Minus => arith(x.wrapping_sub(y)),
        Punct::Star => arith(x.wrapping_mul(y)),
        Punct::Slash | Punct::Percent => {
            if y == 0 {
                if live {
                    return err(loc, "division by zero in preprocessor expression");
                }
                return Ok(arith(0));
            }
            let divide = op == Punct::Slash;
            arith(match (unsigned, divide) {
                (true, true) => (ux / uy) as i64,
                (true, false) => (ux % uy) as i64,
                (false, true) => x.wrapping_div(y),
                (false, false) => x.wrapping_rem(y),
            })
        }
        _ => return err(loc, "invalid operator in preprocessor expression"),
    })
}
