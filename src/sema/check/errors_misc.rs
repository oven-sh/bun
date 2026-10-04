//! Smaller checks of expressions and statements, called where the type is computed or by the walk: 1345 2872 2873, 2869 2871 5076,
//! 2703 2704 2790 18011, 2378, 2678.
//!
//! Follows `checkTruthinessOfType`, `checkNullishCoalesceOperands`, `checkDeleteExpression`, `checkAccessorDeclaration`
//! and `checkSwitchStatement` of TypeScript 7.0.2's checker.go.

use super::*;
use crate::bind::{FnOwner, Parent, UNREACHABLE};

const ALWAYS: u8 = 1;
const NEVER: u8 = 2;
const SOMETIMES: u8 = ALWAYS | NEVER;

impl Checker<'_> {
    /// `checkNullishCoalesceOperands` for `e`, which is `left ?? right`.
    pub(super) fn check_nullish_coalesce_operands(
        &mut self,
        file: FileId,
        e: ExprId,
        left: ExprId,
        right: ExprId,
    ) {
        let hir = self.hir(file);
        // `None` unless `x` is an unparenthesized `BinaryExpression`. The inner option is its operator, `None` for an assignment.
        let operator_of = |x: ExprId| match hir[x].kind {
            _ if is_parenthesized(hir, x) || hir.kind(hir.node(x)) != Kind::BinaryExpression => {
                None
            }
            ExprKind::Binary { op, .. } => Some(Some(op)),
            _ => Some(None),
        };
        let grandparent = hir.parent(hir.node(e));
        let mixed = if hir.kind(grandparent) == Kind::BinaryExpression {
            match hir.data(grandparent) {
                NodeData::Expr(outer) => match hir[outer].kind {
                    ExprKind::Binary {
                        op: BinOp::Or,
                        left,
                        ..
                    } if operator_of(left).is_some() => Some((left, "??", "||")),
                    _ => None,
                },
                _ => None,
            }
        } else if let Some(operator) = operator_of(left) {
            match operator {
                Some(BinOp::Or) => Some((left, "||", "??")),
                Some(BinOp::And) => Some((left, "&&", "??")),
                _ => None,
            }
        } else {
            (operator_of(right) == Some(Some(BinOp::And))).then_some((right, "??", "&&"))
        };
        if let Some((mixed, first, second)) = mixed {
            let at = (
                file,
                self.start_of(file, mixed),
                self.end_of_expr(file, mixed),
            );
            self.grammar_error_at(at, 5076, &[Arg::Text(first), Arg::Text(second)]);
        }
        // `checkNullishCoalesceOperandLeft`
        let left_target = self.skip_outer_expressions(file, left);
        match self.syntactic_nullishness(file, left_target) {
            ALWAYS => self.error(file, left_target, 2871, &[]),
            NEVER => self.error(file, left_target, 2869, &[]),
            _ => return,
        };
    }

    /// `checkSwitchStatement` for one `case test:` of a `switch (expr)`: 2678.
    pub(super) fn check_case_clause(&mut self, file: FileId, expr: ExprId, test: ExprId) {
        let (subject, case) = (self.type_of_expr(file, expr), self.type_of_expr(file, test));
        // `isTypeEqualityComparableTo`, then in the reverse direction.
        let is_nullable = case.is_null() || case.is_undefined();
        if !is_nullable && !self.is_comparable(subject, case) {
            let at = self.span_of_parenthesized_expr(file, test);
            self.check_type_comparable_to(case, subject, Some(at), None);
        }
    }

    /// `checkAccessorDeclaration`: 2378 for a getter whose end is reachable and that has no
    /// `return` statement.
    pub(super) fn check_getter_returns_a_value(&mut self, file: FileId, f: FnId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let func = &hir[f];
        if hir.kind == FileKind::Declaration
            || func.kind != FnKind::Getter
            || func.flags.contains(Flags::AMBIENT)
            || matches!(func.body, FnBody::None)
            || bound.fns[f.idx()].end == UNREACHABLE
            || bound.fns[f.idx()].end.is_none()
            || !bound.fns[f.idx()].returns.is_empty()
        {
            return;
        }
        let (start, end) = match bound.fns[f.idx()].owner {
            FnOwner::Member(m) => (hir[m].name_pos, self.end_of_member_name(file, m)),
            FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                Parent::Prop(p) => (hir[p].pos, self.end_of_prop_name(file, p)),
                _ => return,
            },
            _ => return,
        };
        self.error_at((file, start, end), 2378, &[]);
    }

    /// `SkipOuterExpressions`
    pub(super) fn skip_outer_expressions(&self, file: FileId, mut e: ExprId) -> ExprId {
        let hir = self.hir(file);
        loop {
            e = match hir[e].kind {
                ExprKind::As { expr, .. }
                | ExprKind::Satisfies { expr, .. }
                | ExprKind::AsConst(expr)
                | ExprKind::NonNull(expr)
                | ExprKind::Instantiation { expr, .. } => expr,
                _ => return e,
            };
        }
    }

    fn is_undefined_itself(&self, file: FileId, e: ExprId) -> bool {
        matches!(self.hir(file)[e].kind, ExprKind::Ident(known::undefined))
            && self.bound(file).expr_symbol[e.idx()].is_none()
    }

    /// `checkTruthinessOfType`
    pub(super) fn check_truthiness_of_type(&mut self, file: FileId, node: ExprId, ty: TypeId) {
        let code = if ty == TypeId::VOID {
            1345
        } else {
            match self.syntactic_truthiness(file, node) {
                ALWAYS => 2872,
                NEVER => 2873,
                _ => return,
            }
        };
        self.error_at(self.span_of_parenthesized_expr(file, node), code, &[]);
    }

    /// `GetErrorRangeForNode` for an expression as it appears in the source: the start of an error
    /// about the whole of `e`. If `e` is parenthesized, the error points at the parentheses.
    pub(super) fn error_start_of(&self, file: FileId, e: ExprId) -> u32 {
        if is_parenthesized(self.hir(file), e) {
            self.start_of(file, e)
        } else {
            self.error_start_inside_parentheses(file, e)
        }
    }

    /// The same for `e` itself, ignoring enclosing parentheses. The error points at the name of a
    /// function expression, or else at the name of what it is assigned to, at the own name of a
    /// class expression, and at the keyword of `x satisfies T`.
    pub(super) fn error_start_inside_parentheses(&self, file: FileId, e: ExprId) -> u32 {
        let hir = self.hir(file);
        let elsewhere = match hir[e].kind {
            ExprKind::Fn(f) if hir[f].kind == FnKind::Expr && hir[f].name.is_some() => {
                Some(hir[f].name_pos)
            }
            ExprKind::Fn(f) if hir[f].kind == FnKind::Expr => {
                self.bound(file).get_assigned_name(hir, e)
            }
            ExprKind::Class(c) if hir[c].name.is_some() => Some(hir[c].name_pos),
            // The last word before the type and before a leading `(`, `|` or `&`, which are not
            // stored, or the `{` of `@satisfies {T}` (`findOriginatingJSDocSatisfiesTag`: the name
            // of the tag).
            ExprKind::Satisfies { ty, .. } => {
                let mut before =
                    trim_trivia_end(hir.text.get(..hir[ty].pos as usize).unwrap_or_default());
                while let [rest @ .., b'(' | b'|' | b'&' | b'{'] = before {
                    before = trim_trivia_end(rest);
                }
                before
                    .ends_with(b"satisfies")
                    .then(|| (before.len() - b"satisfies".len()) as u32)
            }
            _ => None,
        };
        elsewhere.unwrap_or_else(|| self.start_inside_parentheses(file, e))
    }

    /// `getSyntacticTruthySemantics`
    fn syntactic_truthiness(&self, file: FileId, e: ExprId) -> u8 {
        let hir = self.hir(file);
        let e = self.skip_outer_expressions(file, e);
        match hir[e].kind {
            // `while (1)`
            ExprKind::Number(n)
                if hir.numbers[n as usize] == 0.0 || hir.numbers[n as usize] == 1.0 =>
            {
                SOMETIMES
            }
            ExprKind::Number(_)
            | ExprKind::Array(_)
            | ExprKind::Fn(_)
            | ExprKind::BigInt(_)
            | ExprKind::Class(_)
            | ExprKind::Object(_)
            | ExprKind::Regex => ALWAYS,
            // Not a fragment.
            ExprKind::Jsx(j) if hir[j].tag.is_some() => ALWAYS,
            ExprKind::Unary { op: UnOp::Void, .. } | ExprKind::Null => NEVER,
            ExprKind::String(text) => {
                if text == known::empty {
                    NEVER
                } else {
                    ALWAYS
                }
            }
            ExprKind::Cond { yes, no, .. } => {
                self.syntactic_truthiness(file, yes) | self.syntactic_truthiness(file, no)
            }
            ExprKind::Ident(_) if self.is_undefined_itself(file, e) => NEVER,
            _ => SOMETIMES,
        }
    }

    /// `getSyntacticNullishnessSemantics`
    fn syntactic_nullishness(&self, file: FileId, e: ExprId) -> u8 {
        let hir = self.hir(file);
        let e = self.skip_outer_expressions(file, e);
        match hir[e].kind {
            ExprKind::Await(_)
            | ExprKind::Call(_)
            | ExprKind::ImportCall { .. }
            | ExprKind::TaggedTemplate(_)
            | ExprKind::Index { .. }
            | ExprKind::ImportMeta
            | ExprKind::NewTarget(_)
            | ExprKind::New(_)
            | ExprKind::Dot { .. }
            | ExprKind::Yield { .. }
            | ExprKind::This
            | ExprKind::Missing => SOMETIMES,
            ExprKind::Binary {
                op: BinOp::Or | BinOp::And,
                ..
            }
            | ExprKind::Assign {
                op: Some(BinOp::Or | BinOp::And),
                ..
            } => SOMETIMES,
            // The right operand decides.
            ExprKind::Binary {
                op: BinOp::Comma | BinOp::Nullish,
                right,
                ..
            } => self.syntactic_nullishness(file, right),
            ExprKind::Assign {
                op: None | Some(BinOp::Nullish),
                value,
                ..
            } => self.syntactic_nullishness(file, value),
            ExprKind::Cond { yes, no, .. } => {
                self.syntactic_nullishness(file, yes) | self.syntactic_nullishness(file, no)
            }
            ExprKind::Null => ALWAYS,
            ExprKind::Ident(_) => {
                if self.is_undefined_itself(file, e) {
                    ALWAYS
                } else {
                    SOMETIMES
                }
            }
            _ => NEVER,
        }
    }

    /// `checkDeleteExpression`
    pub(super) fn check_delete_expression(&mut self, file: FileId, e: ExprId, operand: ExprId) {
        let hir = self.hir(file);
        let start = match hir[operand].kind {
            // `createMissingNode`: a missing operand starts at the end of the previous token.
            ExprKind::Missing if !is_parenthesized(self.hir(file), operand) => {
                hir[e].pos + b"delete".len() as u32
            }
            _ => self.start_inside_parentheses(file, operand),
        };
        // A missing node is empty.
        let end = match hir[operand].kind {
            ExprKind::Missing if !is_parenthesized(self.hir(file), operand) => start,
            _ => self.error_end_inside_parentheses(file, operand),
        };
        let (obj, name) = match hir[operand].kind {
            ExprKind::Dot { obj, name, .. } => (obj, Some(name)),
            // `getPropertyNameFromIndex`: the single property name that the type of the index
            // expression represents.
            ExprKind::Index { obj, index, .. } => {
                let key = self.type_of_expr(file, index);
                (obj, self.property_name_of_type(key))
            }
            // A missing operand is an identifier with empty text, which is not an access expression
            // either.
            _ => {
                self.error_at((file, start, end), 2703, &[]);
                return;
            }
        };
        let Some(name) = name else { return };
        if self.is_private_name(name) && matches!(hir[operand].kind, ExprKind::Dot { .. }) {
            self.error_at((file, start, end), 18011, &[]);
        }
        let object = self.type_of_expr(file, obj);
        if self.is_any(object) {
            return;
        }
        let object = self.non_nullable(object);
        // `getIndexedAccessTypeOrUndefined`: the index expression then represents any string, and
        // no property is looked up.
        if matches!(hir[operand].kind, ExprKind::Index { .. })
            && self.is_string_index_signature_only(object)
        {
            return;
        }
        // `links.resolvedSymbol`
        let Some((prop, mapper)) = self.get_property_of_type(object, name) else {
            return;
        };
        if self.is_read_only(prop) {
            self.error_at((file, start, end), 2704, &[]);
            return;
        }
        // `checkDeleteExpressionMustBeOptional`
        let ty = self.type_of_prop(prop, mapper);
        if !self.p.files.options.strict_null_checks
            || self.is_any(ty)
            || ty == TypeId::UNKNOWN
            || ty.is_never()
        {
            return;
        }
        let is_optional = prop.flags.contains(PropFlags::OPTIONAL)
            || !self.p.files.options.exact_optional_property_types
                && self.some_type(ty, |c, m| {
                    m.is_undefined() || m == TypeId::VOID || c.is_deferred(m)
                });
        if !is_optional {
            self.error_at((file, start, end), 2790, &[]);
        }
    }

    /// `isReadonlySymbol`: among the exports of a namespace or a module, constants and enum
    /// members. Not an alias of one.
    fn is_read_only(&self, prop: &Prop) -> bool {
        match prop.source {
            PropSource::Symbol(export) if !self.is_member_symbol(export) => {
                let flags = self.files().flags(export);
                flags.contains(SymFlags::ENUM_MEMBER)
                    || flags.intersects(SymFlags::VARIABLE) && flags.contains(SymFlags::CONST)
            }
            _ => prop.flags.contains(PropFlags::READONLY),
        }
    }
}
