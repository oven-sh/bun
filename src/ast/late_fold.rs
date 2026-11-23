//! Port of esbuild's late constant fold for cross-module values. It never writes to the AST.

use core::cmp::Ordering;
use core::ptr::NonNull;

use bun_alloc::ArenaVecExt as _;
use bun_alloc::{Arena as Bump, ArenaVec};

use crate::ast_result::TsEnumsMap;
use crate::const_fold::{numeric_binary, to_int32};
use crate::expr::Data;
use crate::nodes::InlinedEnumValueDecoded;
use crate::stmt::Data as StmtData;
use crate::{E, Expr, OpCode, Ref, S, Stmt, StoreRef, symbol};

pub struct LateFold<'a> {
    pub symbols: &'a symbol::Map,
    pub ts_enums: Option<&'a TsEnumsMap>,
    /// See `js_printer::Options::has_dynamic_import_items`.
    pub has_dynamic_import_items: bool,
    pub bump: &'a Bump,
    pub stack_check: bun_core::StackCheck,
}

/// What a subtree stands for once the cross-module references in it are known.
#[derive(Clone, Copy)]
struct Folded {
    expr: Expr,
    /// False when `expr` is only the literal of a reference, which the printer inlines itself.
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

/// The import that `target` names. A pattern local that the linker bound counts as one.
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

/// The value of member `name` of the cross-module enum that the import `base` names.
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

#[inline]
fn number(value: f64) -> Data {
    Data::ENumber(E::Number::new(value))
}

#[inline]
fn boolean(value: bool) -> Data {
    Data::EBoolean(E::Boolean { value })
}

fn fold_unary(op: OpCode, value: &Data) -> Option<Data> {
    Some(match op {
        OpCode::UnPos => number(value.to_number()?),
        OpCode::UnNeg => number(-value.to_number()?),
        OpCode::UnCpl => number(f64::from(!to_int32(value.to_number()?))),
        OpCode::UnNot => boolean(!literal_to_boolean(value)?),
        OpCode::UnVoid if literal_to_boolean(value).is_some() => Data::EUndefined(E::Undefined {}),
        _ => return None,
    })
}

/// The parser's rule for two numbers: it folds every operator, whatever the length of the result.
fn fold_numbers(op: OpCode, left: &Data, right: &Data) -> Option<Data> {
    let [l, r] = Expr::extract_numeric_values(left, right)?;
    Some(match op {
        OpCode::BinLooseEq | OpCode::BinStrictEq => boolean(l == r),
        OpCode::BinLooseNe | OpCode::BinStrictNe => boolean(l != r),
        OpCode::BinLt | OpCode::BinGt | OpCode::BinLe | OpCode::BinGe => {
            let [l, r] = Expr::extract_numeric_values_in_safe_range(left, right)?;
            boolean(match op {
                OpCode::BinLt => l < r,
                OpCode::BinGt => l > r,
                OpCode::BinLe => l <= r,
                _ => l >= r,
            })
        }
        _ => number(numeric_binary(op, l, r)?),
    })
}

fn compare_strings(op: OpCode, left: &E::EString, right: &E::EString) -> Option<Data> {
    if left.next.is_some() || right.next.is_some() || left.is_utf8() != right.is_utf8() {
        return None;
    }
    match op {
        OpCode::BinLooseEq | OpCode::BinStrictEq => {
            return Some(boolean(left.order(right) == Ordering::Equal));
        }
        OpCode::BinLooseNe | OpCode::BinStrictNe => {
            return Some(boolean(left.order(right) != Ordering::Equal));
        }
        _ => {}
    }
    // JavaScript orders strings by UTF-16 code unit: the byte order only for ASCII.
    if !left.is_utf8()
        || !bun_core::is_all_ascii(left.slice8())
        || !bun_core::is_all_ascii(right.slice8())
    {
        return None;
    }
    let order = left.slice8().cmp(right.slice8());
    Some(boolean(match op {
        OpCode::BinLt => order == Ordering::Less,
        OpCode::BinGt => order == Ordering::Greater,
        OpCode::BinLe => order != Ordering::Greater,
        OpCode::BinGe => order != Ordering::Less,
        _ => return None,
    }))
}

impl<'a> LateFold<'a> {
    /// `expr` with its operators on cross-module values evaluated, or `None` when none can be.
    pub fn fold(&self, expr: Expr, spine: &mut Vec<Expr>) -> Option<Expr> {
        match self.visit(expr, spine) {
            Some(Folded {
                expr,
                reduced: true,
            }) => Some(expr),
            _ => None,
        }
    }

    /// `ToBoolean(expr)` when cross-module values decide it without a side effect.
    pub fn to_boolean(&self, expr: Expr, spine: &mut Vec<Expr>) -> Option<bool> {
        literal_to_boolean(&self.visit(expr, spine)?.expr.data)
    }

    /// True when `expr` prints as a string literal. As a statement, that can be a directive.
    pub fn is_string(&self, expr: Expr, spine: &mut Vec<Expr>) -> bool {
        let expr = self.visit(expr, spine).map_or(expr, |folded| folded.expr);
        matches!(expr.unwrap_inlined().data, Data::EString(_))
    }

    /// The statement that replaces `s` when cross-module values decide its test.
    pub fn fold_if(&self, s: &S::If, loc: crate::Loc, spine: &mut Vec<Expr>) -> Option<Stmt> {
        // `if (effect(), E.A)`: the parser merges a preceding expression statement in.
        let (effects, test) = match &s.test.data {
            Data::EBinary(e) if e.op == OpCode::BinComma => (Some(e.left), e.right),
            _ => (None, s.test),
        };
        let value = self.to_boolean(test, spine)?;
        let (live, dead) = if value {
            (Some(s.yes), s.no)
        } else {
            (s.no, Some(s.yes))
        };
        if dead.as_ref().is_some_and(dead_branch_declares) {
            return None;
        }
        let Some(effects) = effects else {
            // A string statement can become a directive where the `if` was.
            if let Some(StmtData::SExpr(live)) = live.map(|stmt| stmt.data)
                && self.is_string(live.value, spine)
            {
                return None;
            }
            return Some(live.unwrap_or(Stmt {
                data: StmtData::SEmpty(S::Empty {}),
                loc,
            }));
        };
        if self.is_string(effects, spine) {
            return None;
        }
        let effects = Stmt {
            data: StmtData::SExpr(StoreRef::from_bump(self.bump.alloc(S::SExpr {
                value: effects,
                does_not_affect_tree_shaking: false,
            }))),
            loc: effects.loc,
        };
        let Some(live) = live else {
            return Some(effects);
        };
        let (rest, close_brace_loc) = match &live.data {
            StmtData::SBlock(block) => (block.stmts.slice(), block.close_brace_loc),
            _ => (core::slice::from_ref(&live), crate::Loc::EMPTY),
        };
        let mut stmts = ArenaVec::with_capacity_in(rest.len() + 1, self.bump);
        stmts.push(effects);
        stmts.extend_from_slice(rest);
        Some(Stmt {
            data: StmtData::SBlock(StoreRef::from_bump(self.bump.alloc(S::Block {
                stmts: crate::StoreSlice::from_bump(stmts),
                close_brace_loc,
            }))),
            loc,
        })
    }

    fn enum_value(&self, target: Expr, name: &[u8]) -> Option<InlinedEnumValueDecoded> {
        let base = import_ref(self.symbols, self.has_dynamic_import_items, target)?;
        imported_enum_value(self.symbols, self.ts_enums, base, name)
    }

    /// The literal that a reference to a value of another file stands for.
    fn inlined(&self, expr: Expr) -> Option<Folded> {
        let value = match &expr.data {
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
            InlinedEnumValueDecoded::Number(value) => number(value),
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
            Data::EDot(_) | Data::EIndex(_) => self.inlined(expr),
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

    /// Iterates over a left-nested chain, as the parser and the printer do: a long one is deep.
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
        // A chain of string `+` appends to one buffer: a new string at each step is quadratic.
        let mut joined: Option<(ArenaVec<'a, u8>, crate::Loc)> = None;
        while spine.len() > base {
            let node = spine.pop().expect("the spine is not empty");
            let Data::EBinary(e) = &node.data else {
                unreachable!()
            };
            let right = self.visit(e.right, spine);
            if e.op == OpCode::BinAdd {
                let right_expr = right.map_or(e.right, |folded| folded.expr);
                if let Some((bytes, _)) = &mut joined {
                    if let Some(string) = self.to_string(right_expr) {
                        bytes.extend_from_slice(string.slice8());
                        continue;
                    }
                } else if (left.is_some() || right.is_some())
                    && let Some((l, r)) =
                        self.string_operands(left.map_or(e.left, |folded| folded.expr), right_expr)
                {
                    let mut bytes = ArenaVec::with_capacity_in(l.len() + r.len(), self.bump);
                    bytes.extend_from_slice(l.slice8());
                    bytes.extend_from_slice(r.slice8());
                    joined = Some((bytes, node.loc));
                    continue;
                }
            }
            if let Some(string) = self.finish_string(&mut joined) {
                left = Some(string);
            }
            left = self.join(node, e, left, right);
        }
        self.finish_string(&mut joined).or(left)
    }

    fn finish_string(&self, joined: &mut Option<(ArenaVec<'a, u8>, crate::Loc)>) -> Option<Folded> {
        let (bytes, loc) = joined.take()?;
        let string = E::EString::init(bytes.into_bump_slice());
        Folded::reduced(Expr {
            data: Data::EString(StoreRef::from_bump(self.bump.alloc(string))),
            loc,
        })
    }

    /// `expr` as a flat UTF-8 string: a string, or a primitive literal that `+` converts to one.
    fn to_string(&self, expr: Expr) -> Option<StoreRef<E::EString>> {
        let string = expr.to_string_expr_without_side_effects(self.bump)?;
        let string = Data::extract_string_value(string.data)?;
        (string.next.is_none() && string.is_utf8()).then_some(string)
    }

    /// The operands of a `+` that concatenates: one of them is a string.
    fn string_operands(
        &self,
        left: Expr,
        right: Expr,
    ) -> Option<(StoreRef<E::EString>, StoreRef<E::EString>)> {
        let is_string = |expr: Expr| matches!(expr.unwrap_inlined().data, Data::EString(_));
        if !is_string(left) && !is_string(right) {
            return None;
        }
        Some((self.to_string(left)?, self.to_string(right)?))
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
        // An operand that was not reduced stays the reference, so it prints with its comment.
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

        let data = match fold_numbers(op, &left.data, &right.data) {
            Some(data) => data,
            None => compare_strings(
                op,
                &*Data::extract_string_value(left.data)?,
                &*Data::extract_string_value(right.data)?,
            )?,
        };
        Some(Expr { data, loc })
    }
}

/// True when dead code still declares a hoisted `var` or function, so the branch must stay.
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
        StmtData::SWith(with) => dead_branch_declares(&with.body),
        StmtData::SSwitch(switch) => switch.cases.slice().iter().any(|case| any(case.body)),
        _ => true,
    }
}
