//! Smaller checks of expressions and statements, called where the type is computed or by the walk: 1345 2872 2873, 2869 2871 5076,
//! 2703 2704 2790 18011, 2378, 2678.
//!
//! Follows `checkTruthinessOfType`, `checkNullishCoalesceOperands`, `checkDeleteExpression`, `checkAccessorDeclaration`
//! and `checkSwitchStatement` of TypeScript 7.0.2's checker.go.

use super::*;
use crate::bind::{FnOwner, Parent, ScopeKind, UNREACHABLE};

const ALWAYS: u8 = 1;
const NEVER: u8 = 2;
const SOMETIMES: u8 = ALWAYS | NEVER;

/// What `getThisContainer` finds around the `this` of `typeof this.x`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum QueriedThisContainer {
    /// A function that is not an arrow function, a method, an accessor, a constructor, a static block, or a signature.
    Fn(FnId),
    /// A property of a class.
    Property,
    /// A property of an interface or of a type literal.
    PropertySignature,
    Module,
    Enum,
    File,
}

impl Checker<'_> {
    /// `checkNullishCoalesceOperands`, of `e`, which is `left ?? right`.
    pub(super) fn check_nullish_coalesce_operands(
        &mut self,
        file: FileId,
        e: ExprId,
        left: ExprId,
        right: ExprId,
    ) {
        let hir = self.hir(file);
        if let Some(mixed) = self.operand_mixed_with_nullish(file, e, left, right) {
            let (first, second) = if mixed == left {
                match hir[left].kind {
                    ExprKind::Binary { op: BinOp::And, .. } => ("&&", "??"),
                    _ => ("||", "??"),
                }
            } else if mixed == right {
                ("??", "&&")
            } else {
                ("??", "||")
            };
            let at = (
                file,
                self.start_of(file, mixed),
                self.end_of_expr(file, mixed),
            );
            self.grammar_error_on_node(at, 5076, &[Arg::Text(first), Arg::Text(second)]);
        }
        // `checkNullishCoalesceOperandLeft`
        let target = self.skip_outer_expressions(file, left);
        let code = match self.syntactic_nullishness(file, target) {
            ALWAYS => 2871,
            NEVER => 2869,
            _ => return,
        };
        let at = (
            file,
            self.error_start_inside_parentheses(file, target),
            self.error_end_inside_parentheses(file, target),
        );
        self.error(at, code, &[]);
    }

    /// `checkSwitchStatement`, of one `case test:` of a `switch (expr)`: 2678.
    pub(super) fn check_case_clause(&mut self, file: FileId, expr: ExprId, test: ExprId) {
        let (subject, case) = (self.type_of_expr(file, expr), self.type_of_expr(file, test));
        if !self.is_known(subject)
            || !self.is_known(case)
            || self.is_uncertain(file, expr)
            || self.is_uncertain(file, test)
        {
            return;
        }
        // `isTypeEqualityComparableTo`, then the other way round.
        let is_nullable = case.is_null() || case.is_undefined();
        if !is_nullable && !self.is_comparable(subject, case) {
            let at = self.place_of_written_expr(file, test);
            self.check_type_comparable_to(case, subject, Some(at), None);
        }
    }

    /// `checkAccessorDeclaration`: 2378, of a getter that gets to its end and never says `return`.
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
        self.error((file, start, end), 2378, &[]);
    }

    /// `checkNullishCoalesceOperands`: the binary expression that mixes `||` or `&&` with the `??` of `e`, which is `left ?? right`,
    /// without parentheses (5076).
    fn operand_mixed_with_nullish(
        &self,
        file: FileId,
        e: ExprId,
        left: ExprId,
        right: ExprId,
    ) -> Option<ExprId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `IsBinaryExpression`. The default of `{ a = b }` is kept as an assignment, and is none.
        let is_binary_kind = |x: ExprId| match hir[x].kind {
            ExprKind::Binary { .. } => true,
            ExprKind::Assign { .. } => {
                !matches!(bound.expr_parent[x.idx()], Parent::Prop(p) if hir[p].kind == PropKind::Shorthand)
            }
            _ => false,
        };
        let is_binary = |x: ExprId| is_binary_kind(x) && !is_parenthesized(self.hir(file), x);
        if let Parent::Expr(outer) = bound.expr_parent[e.idx()]
            && outer.is_some()
            && is_binary_kind(outer)
            && !is_parenthesized(self.hir(file), e)
        {
            return match hir[outer].kind {
                ExprKind::Binary {
                    op: BinOp::Or,
                    left: outer_left,
                    ..
                } if is_binary(outer_left) => Some(outer_left),
                _ => None,
            };
        }
        if is_binary(left) {
            return matches!(
                hir[left].kind,
                ExprKind::Binary {
                    op: BinOp::Or | BinOp::And,
                    ..
                }
            )
            .then_some(left);
        }
        (is_binary(right) && matches!(hir[right].kind, ExprKind::Binary { op: BinOp::And, .. }))
            .then_some(right)
    }

    /// `SkipOuterExpressions`
    fn skip_outer_expressions(&self, file: FileId, mut e: ExprId) -> ExprId {
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
        self.error(self.place_of_written_expr(file, node), code, &[]);
    }

    /// `GetErrorRangeForNode`, for an expression as it is written: where an error about the whole of `e` goes. In parentheses it is
    /// the parentheses that are pointed at.
    pub(super) fn error_start_of(&self, file: FileId, e: ExprId) -> u32 {
        if is_parenthesized(self.hir(file), e) {
            self.start_of(file, e)
        } else {
            self.error_start_inside_parentheses(file, e)
        }
    }

    /// The same, of `e` itself, whatever parentheses it is in. A function expression is pointed at by its name, or else by the name
    /// of what it is given to, a class expression by its own name, `x satisfies T` by the keyword.
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
            // The last word before the type, and before the `(`, `|` or `&` it may be written after, which are not kept, or the
            // `{` of `@satisfies {T}` (`findOriginatingJSDocSatisfiesTag`: the name of the tag).
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

    /// `getThisContainer`, for the `this` of `typeof this.x`: it goes by where the type is written, which is not where the binder
    /// puts the operand. `None`: `this` is not the operand of a `typeof` in a type.
    pub(super) fn this_container_of_type_query(
        &self,
        file: FileId,
        this: ExprId,
        include_arrow_functions: bool,
    ) -> Option<QueriedThisContainer> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let query = hir.types.iter().position(|t| {
            let TypeNodeKind::Typeof { expr, .. } = t.kind else {
                return false;
            };
            let mut at = expr;
            while at.is_some()
                && let ExprKind::Dot { obj, .. } = hir[at].kind
            {
                at = obj;
            }
            at == this
        })?;
        // Out of the types it is written in. What a type literal has are containers, and only signatures have a scope.
        let parents = Self::type_node_parents(hir, bound);
        let mut root = TypeNodeId(query as u32);
        loop {
            let parent = parents[root.idx()];
            if parent.is_none() {
                break;
            }
            if let TypeNodeKind::Object(members) = hir[parent].kind {
                let scope = bound.type_scope[root.idx()];
                return Some(
                    match scope.is_some().then(|| bound.scopes[scope.idx()].kind) {
                        Some(ScopeKind::Fn(f)) if matches!(bound.fns[f.idx()].owner, FnOwner::Member(m) if members.range().contains(&m.idx())) => {
                            QueriedThisContainer::Fn(f)
                        }
                        _ => QueriedThisContainer::PropertySignature,
                    },
                );
            }
            root = parent;
        }
        let mut scope = bound.type_scope[query];
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            match s.kind {
                // These have the `this` of what is around them.
                ScopeKind::Fn(f)
                    if matches!(hir[f].kind, FnKind::FunctionType | FnKind::ConstructorType)
                        || hir[f].kind == FnKind::Arrow && !include_arrow_functions => {}
                ScopeKind::Fn(f) => return Some(QueriedThisContainer::Fn(f)),
                // Its type parameters, and what it extends and implements, are not in a member of it.
                ScopeKind::Class(c) => {
                    let class = &hir[c];
                    let is_in_the_head = class
                        .type_params
                        .iter()
                        .any(|p| hir[p].constraint == root || hir[p].default == root)
                        || hir
                            .ids(class.extends_args)
                            .chain(hir.ids(class.implements))
                            .any(|t| t == root);
                    if !is_in_the_head {
                        return Some(QueriedThisContainer::Property);
                    }
                }
                ScopeKind::Interface(i) => {
                    if hir[i].members.iter().any(|m| hir[m].ty == root) {
                        return Some(QueriedThisContainer::PropertySignature);
                    }
                }
                ScopeKind::Module(_) => return Some(QueriedThisContainer::Module),
                ScopeKind::Enum(_) => return Some(QueriedThisContainer::Enum),
                ScopeKind::File => return Some(QueriedThisContainer::File),
                _ => {}
            }
            scope = s.parent;
        }
        None
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
            // What is on the right decides.
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
            // `createMissingNode`: a missing operand starts where the token before it ends.
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
            // `getPropertyNameFromIndex`: the one name that the type of what is in the brackets stands for.
            ExprKind::Index { obj, index, .. } => {
                let key = self.type_of_expr(file, index);
                (
                    obj,
                    if self.is_known(key) && !self.is_uncertain(file, index) {
                        self.property_name_of_type(key)
                    } else {
                        None
                    },
                )
            }
            // A missing operand is an identifier without text, which is no access expression either.
            _ => {
                self.error((file, start, end), 2703, &[]);
                return;
            }
        };
        let Some(name) = name else { return };
        if self.files().atoms.bytes(name).first() == Some(&b'#')
            && matches!(hir[operand].kind, ExprKind::Dot { .. })
        {
            self.error((file, start, end), 18011, &[]);
        }
        let object = self.type_of_expr(file, obj);
        if !self.is_known(object) || self.is_any(object) || self.is_uncertain(file, obj) {
            return;
        }
        let object = self.non_nullable(object);
        // `getIndexedAccessTypeOrUndefined`: whatever is in the brackets then stands for any string, and no property is looked for.
        if matches!(hir[operand].kind, ExprKind::Index { .. })
            && self.has_only_a_string_index_signature(object)
        {
            return;
        }
        let object = self.apparent_type(object);
        // `createUnionOrIntersectionProperty`: that of a union can only be read if that of a member can only be read, may be left out if
        // that of a member may be, and is whatever any of them is.
        let (mut is_readonly, mut may_be_left_out) = (false, false);
        let mut types = Vec::new();
        for &part in self.parts(object) {
            let part = self.apparent_type(part);
            // `getPropertyOfTypeEx`: what every function and every object has counts, but for a `const` enum, which is no object.
            let found = if self.is_const_enum_object(part) {
                self.prop_of(part, name)
            } else {
                let Some(members) = self.members(part) else {
                    return;
                };
                self.property_of_type(&members, name)
            };
            let Some((prop, mapper)) = found else { return };
            is_readonly |= self.is_read_only(&prop);
            may_be_left_out |= prop.flags.contains(PropFlags::OPTIONAL);
            types.push(self.type_of_prop(&prop, mapper));
        }
        if is_readonly {
            self.error((file, start, end), 2704, &[]);
            return;
        }
        // `checkDeleteExpressionMustBeOptional`
        let ty = self.union(&types);
        if !self.p.files.options.strict_null_checks
            || !self.is_known(ty)
            || self.is_any(ty)
            || ty == TypeId::UNKNOWN
            || ty.is_never()
        {
            return;
        }
        let is_optional = may_be_left_out
            || !self.p.files.options.exact_optional_property_types
                && self.some_type(ty, |c, m| {
                    m.is_undefined() || m == TypeId::VOID || c.is_deferred(m)
                });
        if !is_optional {
            self.error((file, start, end), 2790, &[]);
        }
    }

    /// `isStringIndexSignatureOnlyType`
    fn has_only_a_string_index_signature(&mut self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => parts
                .iter()
                .all(|&p| self.has_only_a_string_index_signature(p)),
            _ => {
                self.is_object_type(ty)
                    && !self.is_generic(ty)
                    && self.members(ty).is_some_and(|m| {
                        m.shape().props.is_empty()
                            && matches!(
                                m.shape().index[..],
                                [IndexInfo {
                                    key: TypeId::STRING,
                                    ..
                                }]
                            )
                    })
            }
        }
    }

    /// `isReadonlySymbol`: of what a namespace or a module exports, constants and the members of enums.
    fn is_read_only(&self, prop: &Prop) -> bool {
        match prop.source {
            PropSource::Symbol(export) => {
                self.files()
                    .resolve_alias_if_needed(export)
                    .is_some_and(|target| {
                        self.files().flags(target).contains(SymFlags::ENUM_MEMBER)
                            || self
                                .files()
                                .decls(target)
                                .first()
                                .is_some_and(|&(of, decl)| {
                                    let crate::bind::Decl::Var(mut root) = decl else {
                                        return false;
                                    };
                                    loop {
                                        match self.bound(of).pat_parent[root.idx()] {
                                            crate::bind::PatParent::Prop(outer, _)
                                            | crate::bind::PatParent::Elem(outer, _) => {
                                                root = outer
                                            }
                                            crate::bind::PatParent::Var(d) => {
                                                return !matches!(
                                                    self.hir(of)[d].kind,
                                                    VarKind::Var | VarKind::Let
                                                );
                                            }
                                            _ => return false,
                                        }
                                    }
                                })
                    })
            }
            _ => prop.flags.contains(PropFlags::READONLY),
        }
    }
}
