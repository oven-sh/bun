//! Constant folding when a bundle is printed.
//!
//! The parser folds constants one file at a time. The value of a TypeScript
//! enum member or of a `const` that another file declares is known only after
//! the linker has bound the import, so an expression on it reaches the printer
//! unfolded. This is esbuild's `lateConstantFoldUnaryOrBinaryOrIfExpr`. It runs
//! after tree shaking: it makes the output smaller, it does not remove a module.
//!
//! The AST is shared between the threads that print, so nothing here writes to
//! it. A changed node is a new node in `bump`.

use core::cmp::Ordering;
use core::ptr::NonNull;

use bun_alloc::Arena as Bump;

use crate::ast_result::{ConstValuesMap, TsEnumsMap};
use crate::expr::Data;
use crate::nodes::InlinedEnumValueDecoded;
use crate::stmt::Data as StmtData;
use crate::{E, Expr, OpCode, Ref, S, Stmt, StoreRef, symbol};

pub struct LateFold<'a> {
    pub symbols: &'a symbol::Map,
    pub ts_enums: Option<&'a TsEnumsMap>,
    pub const_values: Option<&'a ConstValuesMap>,
    /// See `js_printer::Options::has_dynamic_import_items`.
    pub has_dynamic_import_items: bool,
    pub bump: &'a Bump,
    pub stack_check: bun_core::StackCheck,
}

/// What a subtree stands for once the cross-module references in it are known.
#[derive(Clone, Copy)]
struct Folded {
    expr: Expr,
    /// An operator below was evaluated, so `expr` must be printed in place of
    /// the subtree. When false, `expr` is the literal of a reference that the
    /// printer inlines on its own.
    reduced: bool,
}

impl Folded {
    #[inline]
    fn reduced(expr: Expr) -> Option<Folded> {
        Some(Folded {
            expr,
            reduced: true,
        })
    }
}

/// The import `target` names: an import identifier, or a local a pattern binds
/// that the linker bound like one (`const { X } = await import(…)`).
#[inline]
pub fn import_ref(
    symbols: &symbol::Map,
    has_dynamic_import_items: bool,
    target: Expr,
) -> Option<Ref> {
    match &target.data {
        Data::EImportIdentifier(id) => Some(id.ref_),
        Data::EIdentifier(id)
            if has_dynamic_import_items
                && symbols
                    .get_const(id.ref_)
                    .is_some_and(|symbol| symbol.is_bound_import_item()) =>
        {
            Some(id.ref_)
        }
        _ => None,
    }
}

/// The value of the member `name` when the import `base` (see `import_ref`) is
/// an enum that another file declares.
pub fn imported_enum_value(
    symbols: &symbol::Map,
    ts_enums: Option<&TsEnumsMap>,
    base: Ref,
    name: &[u8],
) -> Option<InlinedEnumValueDecoded> {
    let ts_enums = ts_enums?;
    let ref_ = symbols.follow(base);
    if symbols.get_const(ref_)?.kind != symbol::Kind::TsEnum {
        return None;
    }
    Some(ts_enums.get(&ref_)?.get(name)?.decode())
}

/// The literal that a read of the import `ref_` prints as, when the import is
/// bound to a constant in `const_values` (`LinkerGraph::const_values`).
///
/// The linker does not count such a read as a use of the declaration. It
/// decides that with the same two tests, so both must change together: the
/// symbol of the read is an import, and what it is bound to is in the map.
#[inline]
pub fn inlined_const(
    symbols: &symbol::Map,
    const_values: Option<&ConstValuesMap>,
    ref_: Ref,
) -> Option<Expr> {
    let const_values = const_values?;
    if symbols.get_const(ref_)?.kind != symbol::Kind::Import {
        return None;
    }
    const_values.get(&symbols.follow(ref_)).copied()
}

/// esbuild's `ExprToConstValue`: the literals that are short enough to copy
/// into every read of a constant.
pub fn is_const_value(value: &Expr) -> bool {
    match &value.data {
        Data::ENull(_) | Data::EUndefined(_) | Data::EBoolean(_) => true,
        // An integer, or a number that prints in 8 characters or fewer.
        Data::ENumber(e) => {
            let value = e.value();
            value == (value as i64) as f64 || shortest_number_len(value) <= 8
        }
        Data::EString(e) => {
            e.next.is_none()
                && if e.is_utf8() {
                    core::str::from_utf8(e.slice8())
                        .is_ok_and(|string| string.encode_utf16().take(4).count() <= 3)
                } else {
                    e.slice16().len() <= 3
                }
        }
        _ => false,
    }
}

/// The length of Go's `strconv.FormatFloat(value, 'g', -1, 64)`, which is what
/// esbuild measures.
fn shortest_number_len(value: f64) -> usize {
    struct Buffer {
        bytes: [u8; 32],
        len: usize,
    }
    impl core::fmt::Write for Buffer {
        fn write_str(&mut self, string: &str) -> core::fmt::Result {
            let end = self.len + string.len();
            self.bytes
                .get_mut(self.len..end)
                .ok_or(core::fmt::Error)?
                .copy_from_slice(string.as_bytes());
            self.len = end;
            Ok(())
        }
    }

    if !value.is_finite() {
        return 4;
    }
    // `{:e}` prints the shortest digits that round-trip: "-1.5e-7".
    let mut buffer = Buffer {
        bytes: [0; 32],
        len: 0,
    };
    if core::fmt::Write::write_fmt(&mut buffer, format_args!("{value:e}")).is_err() {
        return usize::MAX;
    }
    let text = &buffer.bytes[..buffer.len];
    let Some(e) = bun_core::strings::index_of_char_usize(text, b'e') else {
        return usize::MAX;
    };
    let sign = usize::from(value.is_sign_negative());
    let digits = text[..e]
        .iter()
        .filter(|byte| byte.is_ascii_digit())
        .count();
    let Some(exponent) = core::str::from_utf8(&text[e + 1..])
        .ok()
        .and_then(|exponent| exponent.parse::<i32>().ok())
    else {
        return usize::MAX;
    };
    // Go's shortest `%g` switches to an exponent below 1e-4 and from 1e6 on.
    if !(-4..6).contains(&exponent) {
        // "1.5e-07": at least two exponent digits.
        let exponent_digits = (text.len() - e - 1 - usize::from(exponent < 0)).max(2);
        return sign + digits + usize::from(digits > 1) + 2 + exponent_digits;
    }
    let exponent = exponent as isize;
    sign + if exponent < 0 {
        // "0.0015"
        1 + (-exponent) as usize + digits
    } else if digits as isize <= exponent + 1 {
        (exponent + 1) as usize
    } else {
        digits + 1
    }
}

/// esbuild's `isSafeForConstLocalPrefix`: an initializer that cannot run code
/// of another module.
pub fn is_safe_for_const_prefix(value: &Expr) -> bool {
    match &value.data {
        Data::EMissing(_)
        | Data::EString(_)
        | Data::ERegExp(_)
        | Data::EBigInt(_)
        | Data::EFunction(_)
        | Data::EArrow(_) => true,
        Data::EArray(e) => e.items.iter().all(is_safe_for_const_prefix),
        Data::EObject(e) => e.properties.len() == 0,
        _ => false,
    }
}

/// `ToBoolean` of a primitive literal.
fn literal_to_boolean(data: &Data) -> Option<bool> {
    match data {
        Data::ENull(_) | Data::EUndefined(_) => Some(false),
        Data::EBoolean(e) | Data::EBranchBoolean(e) => Some(e.value),
        Data::ENumber(e) => Some(e.value() != 0.0 && !e.value().is_nan()),
        Data::EString(e) => Some(e.is_present()),
        Data::EInlinedEnum(e) => literal_to_boolean(&e.value.data),
        _ => None,
    }
}

/// esbuild's `ToInt32`.
pub fn to_int32(f: f64) -> i32 {
    if !f.is_finite() {
        return 0;
    }
    // The `%` keeps the value in [0, u32::MAX], so the `as u32` cast is exact.
    let uint = (f.abs() % (u32::MAX as f64 + 1.0)) as u32;
    let int = uint as i32;
    if f < 0.0 { 0i32.wrapping_sub(int) } else { int }
}

#[inline]
fn to_uint32(f: f64) -> u32 {
    to_int32(f) as u32
}

/// esbuild's `approximatePrintedIntCharCount`.
fn approximate_printed_int_char_count(value: f64) -> u32 {
    let digits = 1 + value.abs().log10().floor().max(0.0) as u32;
    digits + u32::from(value < 0.0)
}

#[inline]
fn number(value: f64) -> Option<Data> {
    Some(Data::ENumber(E::Number::new(value)))
}

#[inline]
fn boolean(value: bool) -> Option<Data> {
    Some(Data::EBoolean(E::Boolean { value }))
}

#[inline]
fn is_small_int(value: f64, max: f64) -> bool {
    value == value.trunc() && value.abs() <= max
}

fn fold_unary(op: OpCode, value: &Data) -> Option<Data> {
    match op {
        OpCode::UnPos => number(value.to_number()?),
        OpCode::UnNeg => number(-value.to_number()?),
        OpCode::UnCpl => number(f64::from(!to_int32(value.to_number()?))),
        OpCode::UnNot => boolean(!literal_to_boolean(value)?),
        _ => None,
    }
}

/// esbuild's `ShouldFoldBinaryOperatorWhenMinifying` and `FoldBinaryOperator`
/// for two numbers. An operator is folded only when the result is not longer
/// than the operation.
fn fold_numbers(op: OpCode, left: f64, right: f64) -> Option<Data> {
    match op {
        OpCode::BinAdd | OpCode::BinSub
            if is_small_int(left, 4294967295.0) && is_small_int(right, 4294967295.0) =>
        {
            number(if op == OpCode::BinAdd {
                left + right
            } else {
                left - right
            })
        }
        OpCode::BinMul if is_small_int(left, 255.0) && is_small_int(right, 255.0) => {
            number(left * right)
        }
        // "0/0" => "NaN", "1/0" => "Infinity", "1/-0" => "-Infinity"
        OpCode::BinDiv if right == 0.0 => number(left / right),
        OpCode::BinShl => {
            // "1 << 3" => "8", but "1 << 24" stays: it is shorter than "16777216"
            let result = f64::from(to_int32(left).wrapping_shl(to_uint32(right) & 31));
            if approximate_printed_int_char_count(result)
                <= approximate_printed_int_char_count(left)
                    + 2
                    + approximate_printed_int_char_count(right)
            {
                number(result)
            } else {
                None
            }
        }
        OpCode::BinShr => number(f64::from(
            to_int32(left).wrapping_shr(to_uint32(right) & 31),
        )),
        OpCode::BinUShr => {
            // "10 >>> 1" => "5", but "-1 >>> 0" stays: it is shorter than "4294967295"
            let result = f64::from(to_uint32(left).wrapping_shr(to_uint32(right) & 31));
            if approximate_printed_int_char_count(result)
                <= approximate_printed_int_char_count(left)
                    + 3
                    + approximate_printed_int_char_count(right)
            {
                number(result)
            } else {
                None
            }
        }
        OpCode::BinBitwiseAnd => number(f64::from(to_int32(left) & to_int32(right))),
        OpCode::BinBitwiseOr => number(f64::from(to_int32(left) | to_int32(right))),
        OpCode::BinBitwiseXor => number(f64::from(to_int32(left) ^ to_int32(right))),
        OpCode::BinLt => boolean(left < right),
        OpCode::BinGt => boolean(left > right),
        OpCode::BinLe => boolean(left <= right),
        OpCode::BinGe => boolean(left >= right),
        OpCode::BinLooseEq | OpCode::BinStrictEq => boolean(left == right),
        OpCode::BinLooseNe | OpCode::BinStrictNe => boolean(left != right),
        _ => None,
    }
}

impl<'a> LateFold<'a> {
    /// `expr` with the operators on cross-module values evaluated, or `None`
    /// when no operator in it can be. `expr` is a unary, binary or conditional
    /// expression. `spine` is scratch space.
    pub fn fold(&self, expr: Expr, spine: &mut Vec<Expr>) -> Option<Expr> {
        match self.visit(expr, spine) {
            Some(Folded {
                expr,
                reduced: true,
            }) => Some(expr),
            _ => None,
        }
    }

    /// `ToBoolean(expr)` when cross-module values decide it and evaluating
    /// `expr` has no side effect.
    pub fn to_boolean(&self, expr: Expr, spine: &mut Vec<Expr>) -> Option<bool> {
        literal_to_boolean(&self.visit(expr, spine)?.expr.data)
    }

    fn enum_value(&self, target: Expr, name: &[u8]) -> Option<InlinedEnumValueDecoded> {
        let base = import_ref(self.symbols, self.has_dynamic_import_items, target)?;
        imported_enum_value(self.symbols, self.ts_enums, base, name)
    }

    /// The literal that a reference to a value of another file stands for.
    fn inlined(&self, expr: Expr) -> Option<Folded> {
        let value = match &expr.data {
            Data::EImportIdentifier(e) => {
                return Some(Folded {
                    expr: Expr {
                        data: inlined_const(self.symbols, self.const_values, e.ref_)?.data,
                        loc: expr.loc,
                    },
                    reduced: false,
                });
            }
            Data::EDot(e) if e.optional_chain.is_none() => self.enum_value(e.target, &e.name)?,
            Data::EIndex(e) if e.optional_chain.is_none() => {
                let Data::EString(name) = &e.index.data else {
                    return None;
                };
                if name.next.is_some() || !name.is_utf8() {
                    return None;
                }
                self.enum_value(e.target, name.slice8())?
            }
            _ => return None,
        };
        let data = match value {
            InlinedEnumValueDecoded::Number(value) => Data::ENumber(E::Number::new(value)),
            InlinedEnumValueDecoded::String(string) => {
                Data::EString(StoreRef::from(NonNull::new(string.cast_mut())?))
            }
        };
        Some(Folded {
            expr: Expr {
                data,
                loc: expr.loc,
            },
            reduced: false,
        })
    }

    fn visit(&self, expr: Expr, spine: &mut Vec<Expr>) -> Option<Folded> {
        match &expr.data {
            Data::EImportIdentifier(_) | Data::EDot(_) | Data::EIndex(_) => self.inlined(expr),
            Data::EUnary(e) => {
                if !self.stack_check.is_safe_to_recurse() {
                    return None;
                }
                let value = self.visit(e.value, spine)?;
                if let Some(data) = fold_unary(e.op, &value.expr.data) {
                    return Folded::reduced(Expr {
                        data,
                        loc: expr.loc,
                    });
                }
                if !value.reduced {
                    return None;
                }
                Folded::reduced(Expr {
                    data: Data::EUnary(StoreRef::from_bump(self.bump.alloc(E::Unary {
                        op: e.op,
                        value: value.expr,
                        flags: e.flags,
                    }))),
                    loc: expr.loc,
                })
            }
            Data::EBinary(_) => self.visit_binary(expr, spine),
            Data::EIf(e) => {
                if !self.stack_check.is_safe_to_recurse() {
                    return None;
                }
                let test = self.visit(e.test, spine)?;
                if let Some(value) = literal_to_boolean(&test.expr.data) {
                    let branch = if value { e.yes } else { e.no };
                    return Folded::reduced(match self.visit(branch, spine) {
                        Some(folded) => folded.expr,
                        None => branch,
                    });
                }
                if !test.reduced {
                    return None;
                }
                Folded::reduced(Expr {
                    data: Data::EIf(StoreRef::from_bump(self.bump.alloc(E::If {
                        test: test.expr,
                        yes: e.yes,
                        no: e.no,
                    }))),
                    loc: expr.loc,
                })
            }
            _ => None,
        }
    }

    /// The parser and the printer iterate over a chain of left-nested binary
    /// expressions, because a long chain overflows the stack. So does this.
    fn visit_binary(&self, root: Expr, spine: &mut Vec<Expr>) -> Option<Folded> {
        if !self.stack_check.is_safe_to_recurse() {
            return None;
        }
        let base = spine.len();
        let mut bottom = root;
        while let Data::EBinary(e) = &bottom.data {
            spine.push(bottom);
            bottom = e.left;
        }
        let mut left = self.visit(bottom, spine);
        while spine.len() > base {
            let node = spine.pop().expect("the spine is not empty");
            let Data::EBinary(e) = &node.data else {
                unreachable!()
            };
            let right = self.visit(e.right, spine);
            left = self.join(node, e, left, right);
        }
        left
    }

    fn join(
        &self,
        node: Expr,
        e: &E::Binary,
        left: Option<Folded>,
        right: Option<Folded>,
    ) -> Option<Folded> {
        if left.is_none() && right.is_none() {
            return None;
        }
        let left = left.unwrap_or(Folded {
            expr: e.left,
            reduced: false,
        });
        let right = right.unwrap_or(Folded {
            expr: e.right,
            reduced: false,
        });
        if let Some(result) = self.fold_binary(e.op, left.expr, right.expr, node.loc) {
            return Folded::reduced(result);
        }
        if !left.reduced && !right.reduced {
            return None;
        }
        // An operand that was not reduced stays the reference. It prints as the
        // same literal, with the name of the enum member in a comment.
        Folded::reduced(Expr {
            data: Data::EBinary(StoreRef::from_bump(self.bump.alloc(E::Binary {
                op: e.op,
                left: if left.reduced { left.expr } else { e.left },
                right: if right.reduced { right.expr } else { e.right },
            }))),
            loc: node.loc,
        })
    }

    fn fold_binary(&self, op: OpCode, left: Expr, right: Expr, loc: crate::Loc) -> Option<Expr> {
        // A primitive literal on the left decides which operand is the result.
        match op {
            OpCode::BinLogicalAnd => {
                return Some(if literal_to_boolean(&left.data)? {
                    right
                } else {
                    left
                });
            }
            OpCode::BinLogicalOr => {
                return Some(if literal_to_boolean(&left.data)? {
                    left
                } else {
                    right
                });
            }
            OpCode::BinNullishCoalescing => {
                literal_to_boolean(&left.data)?;
                return Some(match left.unwrap_inlined().data {
                    Data::ENull(_) | Data::EUndefined(_) => right,
                    _ => left,
                });
            }
            _ => {}
        }

        let data =
            if let Some([left, right]) = Expr::extract_numeric_values(&left.data, &right.data) {
                fold_numbers(op, left, right)?
            } else {
                let left = Data::extract_string_value(left.data)?;
                let right = Data::extract_string_value(right.data)?;
                self.fold_strings(op, &left, &right)?
            };
        Some(Expr { data, loc })
    }

    fn fold_strings(&self, op: OpCode, left: &E::EString, right: &E::EString) -> Option<Data> {
        // A rope is flattened in place, and this must not write to the AST.
        if left.next.is_some() || right.next.is_some() || left.is_utf8() != right.is_utf8() {
            return None;
        }
        match op {
            OpCode::BinLooseEq | OpCode::BinStrictEq => {
                return boolean(left.order(right) == Ordering::Equal);
            }
            OpCode::BinLooseNe | OpCode::BinStrictNe => {
                return boolean(left.order(right) != Ordering::Equal);
            }
            _ => {}
        }
        // JavaScript orders strings by UTF-16 code unit. That is the byte order
        // only for ASCII.
        if !left.is_utf8()
            || !bun_core::is_all_ascii(left.slice8())
            || !bun_core::is_all_ascii(right.slice8())
        {
            return None;
        }
        let order = left.slice8().cmp(right.slice8());
        match op {
            OpCode::BinAdd => {
                let joined = self
                    .bump
                    .alloc_slice_fill_copy(left.slice8().len() + right.slice8().len(), 0u8);
                joined[..left.slice8().len()].copy_from_slice(left.slice8());
                joined[left.slice8().len()..].copy_from_slice(right.slice8());
                let mut string = E::EString::init(joined);
                string.prefer_template = left.prefer_template || right.prefer_template;
                Some(Data::EString(StoreRef::from_bump(self.bump.alloc(string))))
            }
            OpCode::BinLt => boolean(order == Ordering::Less),
            OpCode::BinGt => boolean(order == Ordering::Greater),
            OpCode::BinLe => boolean(order != Ordering::Greater),
            OpCode::BinGe => boolean(order != Ordering::Less),
            _ => None,
        }
    }
}

/// A statement that never runs still declares what it hoists out of itself: a
/// `var`, or a function in sloppy mode. The parser keeps those declarations
/// when it removes dead code (`should_keep_stmt_in_dead_control_flow`). The
/// printer does not rewrite statements, so it keeps such a branch whole.
pub fn dead_branch_declares(stmt: &Stmt) -> bool {
    fn any(stmts: crate::StoreSlice<Stmt>) -> bool {
        stmts.slice().iter().any(dead_branch_declares)
    }
    match &stmt.data {
        StmtData::SEmpty(_)
        | StmtData::SExpr(_)
        | StmtData::SThrow(_)
        | StmtData::SReturn(_)
        | StmtData::SBreak(_)
        | StmtData::SContinue(_)
        | StmtData::SClass(_)
        | StmtData::SDebugger(_) => false,
        StmtData::SLocal(local) => local.kind == S::Kind::KVar,
        StmtData::SBlock(block) => any(block.stmts),
        StmtData::STry(try_) => {
            any(try_.body)
                || try_.catch.as_ref().is_some_and(|catch| any(catch.body))
                || try_
                    .finally
                    .as_ref()
                    .is_some_and(|finally| any(finally.stmts))
        }
        StmtData::SIf(if_) => {
            dead_branch_declares(&if_.yes) || if_.no.as_ref().is_some_and(dead_branch_declares)
        }
        StmtData::SWhile(while_) => dead_branch_declares(&while_.body),
        StmtData::SDoWhile(do_while) => dead_branch_declares(&do_while.body),
        StmtData::SFor(for_) => {
            for_.init.as_ref().is_some_and(dead_branch_declares) || dead_branch_declares(&for_.body)
        }
        StmtData::SForIn(for_) => {
            dead_branch_declares(&for_.init) || dead_branch_declares(&for_.body)
        }
        StmtData::SForOf(for_) => {
            dead_branch_declares(&for_.init) || dead_branch_declares(&for_.body)
        }
        StmtData::SLabel(label) => dead_branch_declares(&label.stmt),
        _ => true,
    }
}
