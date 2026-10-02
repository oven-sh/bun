//! From declarations and type syntax to types.

use super::errors_x_enums_names::{Location, is_declared_before_use};
use super::*;
use crate::bind::{Decl, PatParent, ScopeId, ScopeKind};
use smallvec::SmallVec;

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Predicate {
    /// The index of the parameter it is about. `None`: `this`.
    pub param: Option<usize>,
    /// `None` for `asserts x`.
    pub ty: Option<TypeId>,
    pub asserts: bool,
}

/// What a piece of type syntax may refer to, of the type parameters around it.
#[derive(Default)]
struct Mentioned {
    /// The names of the type parameters around it. A type reference by another name is not resolved.
    candidates: SmallVec<[Atom; 8]>,
    /// What the type references by those names resolve to, and what the `infer`s declare.
    type_params: SmallVec<[Sym; 8]>,
    this: bool,
    /// The scopes that declare the values asked about with `typeof`: their types can involve the type parameters seen from there.
    values_in: Vec<(FileId, ScopeId)>,
    /// There is no telling.
    everything: bool,
}

/// `toInt32` of jsnum.go
fn to_int32(n: f64) -> i32 {
    if !n.is_finite() {
        return 0;
    }
    (n.trunc() % 4294967296.0) as i64 as i32
}

/// The operators `evaluate` knows, on numbers.
fn number_operation(op: BinOp, a: f64, b: f64) -> Option<f64> {
    let shift = to_int32(b) as u32 & 31;
    Some(match op {
        BinOp::BitOr => f64::from(to_int32(a) | to_int32(b)),
        BinOp::BitAnd => f64::from(to_int32(a) & to_int32(b)),
        BinOp::BitXor => f64::from(to_int32(a) ^ to_int32(b)),
        BinOp::Shr => f64::from(to_int32(a) >> shift),
        BinOp::UShr => f64::from(to_int32(a) as u32 >> shift),
        BinOp::Shl => f64::from(to_int32(a) << shift),
        BinOp::Mul => a * b,
        BinOp::Div => a / b,
        BinOp::Add => a + b,
        BinOp::Sub => a - b,
        BinOp::Rem => a % b,
        // `Exponentiate` of jsnum.go
        BinOp::Pow if (a == 1.0 || a == -1.0) && b.is_infinite() || a == 1.0 && b.is_nan() => {
            f64::NAN
        }
        BinOp::Pow => a.powf(b),
        _ => return None,
    })
}

/// `evaluator.Result`
#[derive(Copy, Clone, Default)]
pub(super) struct Evaluated {
    pub(super) value: Option<EnumValue>,
    pub(super) is_syntactically_string: bool,
    pub(super) resolved_other_files: bool,
    pub(super) has_external_references: bool,
}

impl Evaluated {
    /// There is one `NaN`.
    pub(super) fn number(n: f64) -> Evaluated {
        let n = if n.is_nan() { f64::NAN } else { n };
        Evaluated {
            value: Some(EnumValue::Number(n.to_bits())),
            ..Evaluated::default()
        }
    }
}

/// `evaluate` of evaluator.go, with `evaluateEntity` and `evaluateEnumMember` of the checker. Two ask: the checker, for one member at a
/// time in whatever order it is asked, and `EnumValues`, which goes through a file in the order of `computeEnumMemberValues` and says
/// what is said on the way.
pub(super) trait Evaluator<'p> {
    fn checker(&mut self) -> &mut Checker<'p>;

    /// There is no room to go on.
    fn give_up(&mut self);

    /// `resolveEntityName(e, SymbolFlagsValue, ignoreErrors)`, in what is evaluated for `location`.
    fn resolve_entity_name(&mut self, file: FileId, e: ExprId, location: Location) -> Option<Sym>;

    /// Whether the initializer of the constant `d` can be gone into. `leave_variable` follows if it can.
    fn enter_variable(&mut self, file: FileId, d: VarDeclId) -> bool;

    fn leave_variable(&mut self);

    /// The error `code` of `evaluateEnumMember` at `e`, which is about `symbol`.
    fn report(&mut self, file: FileId, e: ExprId, code: u32, symbol: Sym);

    /// `getEnumMemberValue`, in what is evaluated for `location`.
    fn enum_member_value_at(
        &mut self,
        file: FileId,
        member: EnumMemberId,
        location: Location,
    ) -> Evaluated;

    /// `evaluate`. `location`: what `e` is evaluated for, the member of an enum or the constant that it is (part of) the initializer of,
    /// or else the expression asked about. Parentheses are not kept, and nothing else is looked through.
    fn evaluate(&mut self, file: FileId, e: ExprId, location: Location) -> Evaluated {
        if self.checker().is_stack_low() {
            self.give_up();
            return Evaluated::default();
        }
        let hir = self.checker().hir(file);
        match hir[e].kind {
            // A `PrefixUnaryExpression`, which `typeof`, `void` and `delete` are not.
            ExprKind::Unary {
                op:
                    op @ (UnOp::Plus
                    | UnOp::Minus
                    | UnOp::BitNot
                    | UnOp::Not
                    | UnOp::PreInc
                    | UnOp::PreDec),
                operand,
            } => {
                let result = self.evaluate(file, operand, location);
                let value = match (op, result.value) {
                    (UnOp::Plus, Some(EnumValue::Number(n))) => Some(f64::from_bits(n)),
                    (UnOp::Minus, Some(EnumValue::Number(n))) => Some(-f64::from_bits(n)),
                    (UnOp::BitNot, Some(EnumValue::Number(n))) => {
                        Some(f64::from(!to_int32(f64::from_bits(n))))
                    }
                    _ => None,
                };
                Evaluated {
                    value: value.and_then(|n| Evaluated::number(n).value),
                    is_syntactically_string: false,
                    ..result
                }
            }
            ExprKind::Binary { op, left, right } => {
                self.evaluate_binary(file, Some(op), left, right, location)
            }
            // An assignment is a `BinaryExpression` with an operator that gives nothing.
            ExprKind::Assign { target, value, .. } => {
                self.evaluate_binary(file, None, target, value, location)
            }
            ExprKind::String(text) => Evaluated {
                value: Some(EnumValue::String(text)),
                is_syntactically_string: true,
                ..Evaluated::default()
            },
            // `evaluateTemplateExpression`
            ExprKind::Template { exprs, texts } => {
                let atoms = &self.checker().files().atoms;
                let mut text = atoms.bytes(hir.id_at(texts, 0)).to_vec();
                let mut result = Evaluated {
                    is_syntactically_string: true,
                    ..Evaluated::default()
                };
                for (i, span) in hir.ids(exprs).enumerate() {
                    let of_span = self.evaluate(file, span, location);
                    let Some(value) = of_span.value else {
                        return Evaluated {
                            is_syntactically_string: true,
                            ..Evaluated::default()
                        };
                    };
                    text.extend_from_slice(self.checker().constant_text(value));
                    text.extend_from_slice(atoms.bytes(hir.id_at(texts, i + 1)));
                    result.resolved_other_files |= of_span.resolved_other_files;
                    result.has_external_references |= of_span.has_external_references;
                }
                result.value = Some(EnumValue::String(atoms.intern(&text)));
                result
            }
            ExprKind::Number(n) => Evaluated::number(hir.numbers[n as usize]),
            ExprKind::Ident(_) | ExprKind::Index { .. } => self.evaluate_entity(file, e, location),
            ExprKind::Dot { .. } if is_property_access_entity_name_expression(hir, e) => {
                self.evaluate_entity(file, e, location)
            }
            _ => Evaluated::default(),
        }
    }

    fn evaluate_binary(
        &mut self,
        file: FileId,
        op: Option<BinOp>,
        left: ExprId,
        right: ExprId,
        location: Location,
    ) -> Evaluated {
        let (l, r) = (
            self.evaluate(file, left, location),
            self.evaluate(file, right, location),
        );
        let value = match (l.value, r.value, op) {
            (Some(EnumValue::Number(a)), Some(EnumValue::Number(b)), Some(op)) => {
                number_operation(op, f64::from_bits(a), f64::from_bits(b))
                    .and_then(|n| Evaluated::number(n).value)
            }
            (Some(a), Some(b), Some(BinOp::Add)) => {
                let c = self.checker();
                let text = [c.constant_text(a), c.constant_text(b)].concat();
                Some(EnumValue::String(c.files().atoms.intern(&text)))
            }
            _ => None,
        };
        Evaluated {
            value,
            is_syntactically_string: (l.is_syntactically_string || r.is_syntactically_string)
                && op == Some(BinOp::Add),
            resolved_other_files: l.resolved_other_files || r.resolved_other_files,
            has_external_references: l.has_external_references || r.has_external_references,
        }
    }

    /// `evaluateEntity`: by what the names mean, never by the type of the expression.
    fn evaluate_entity(&mut self, file: FileId, e: ExprId, location: Location) -> Evaluated {
        let (hir, files) = (self.checker().hir(file), self.checker().files());
        if let ExprKind::Index { obj, index, .. } = hir[e].kind {
            let name = match hir[index].kind {
                ExprKind::String(name) => name,
                ExprKind::Template { exprs, texts } if exprs.is_empty() => hir.id_at(texts, 0),
                _ => return Evaluated::default(),
            };
            // Neither `(a)["b"]` nor `a[("b")]`.
            if is_parenthesized(hir, index) || !is_entity_name_expression(hir, obj) {
                return Evaluated::default();
            }
            if let Some(root) = self.resolve_entity_name(file, obj, location)
                && files.flags(root).contains(SymFlags::ENUM)
                && let Some(member) = files.export(root, name)
                && files.flags(member).contains(SymFlags::ENUM_MEMBER)
            {
                return self.evaluate_enum_member(file, e, member, location);
            }
            return Evaluated::default();
        }
        let Some(symbol) = self.resolve_entity_name(file, e, location) else {
            return Evaluated::default();
        };
        // `Infinity` and `NaN`, unless they are somebody's own.
        if let ExprKind::Ident(name) = hir[e].kind
            && let Some(n) = match files.atoms.bytes(name) {
                b"Infinity" => Some(f64::INFINITY),
                b"NaN" => Some(f64::NAN),
                _ => None,
            }
            && files.global(name, SymFlags::VALUE) == Some(symbol)
        {
            return Evaluated::number(n);
        }
        if files.flags(symbol).contains(SymFlags::ENUM_MEMBER) {
            return self.evaluate_enum_member(file, e, symbol, location);
        }
        if let Some((of, d)) = self
            .checker()
            .constant_variable_declaration(symbol, location)
            && self.enter_variable(of, d)
        {
            let initializer = self.checker().hir(of)[d].init;
            let result = self.evaluate(of, initializer, Location::Variable(of, d));
            self.leave_variable();
            if location.file() != of {
                return Evaluated {
                    value: result.value,
                    is_syntactically_string: false,
                    resolved_other_files: true,
                    has_external_references: true,
                };
            }
            return Evaluated {
                has_external_references: true,
                ..result
            };
        }
        Evaluated::default()
    }

    /// `evaluateEnumMember`
    fn evaluate_enum_member(
        &mut self,
        file: FileId,
        e: ExprId,
        symbol: Sym,
        location: Location,
    ) -> Evaluated {
        // `symbol.ValueDeclaration`
        let declaration = self
            .checker()
            .files()
            .decls_of(symbol)
            .iter()
            .find_map(|&(of, decl)| match decl {
                Decl::EnumMember(member) => Some((of, member)),
                _ => None,
            });
        let Some((of, member)) =
            declaration.filter(|&(of, member)| Location::Member(of, member) != location)
        else {
            self.report(file, e, 2565, symbol);
            return Evaluated::default();
        };
        if !is_declared_before_use(self.checker(), Location::Member(of, member), location) {
            self.report(file, e, 2651, symbol);
            return Evaluated::number(0.0);
        }
        let value = self.enum_member_value_at(of, member, location);
        // `location.Parent != declaration.Parent`
        let owner = &self.checker().bound(of).enum_member_owner;
        let is_of_the_same_enum = matches!(location, Location::Member(file, using)
            if file == of && owner[using.idx()] == owner[member.idx()]);
        Evaluated {
            has_external_references: value.has_external_references || !is_of_the_same_enum,
            ..value
        }
    }
}

impl<'p> Evaluator<'p> for Checker<'p> {
    fn checker(&mut self) -> &mut Checker<'p> {
        self
    }

    fn give_up(&mut self) {
        self.gave_up();
    }

    fn resolve_entity_name(&mut self, file: FileId, e: ExprId, _: Location) -> Option<Sym> {
        self.resolve_entity_name_expression(file, e, SymFlags::VALUE)
    }

    /// Between files there is no before and after: constants of two files may be declared as each other.
    fn enter_variable(&mut self, _: FileId, _: VarDeclId) -> bool {
        let has_room = self.constant_depth <= 16;
        self.constant_depth += u32::from(has_room);
        has_room
    }

    fn leave_variable(&mut self) {
        self.constant_depth -= 1;
    }

    fn report(&mut self, _: FileId, _: ExprId, _: u32, _: Sym) {}

    /// `computeEnumMemberValues` goes through a declaration in order: where before and after do not count, in what is only declared, a
    /// later member of the declaration being gone through has no value yet.
    fn enum_member_value_at(
        &mut self,
        file: FileId,
        member: EnumMemberId,
        location: Location,
    ) -> Evaluated {
        let owner = &self.bound(file).enum_member_owner;
        if let Location::Member(of, using) = location
            && of == file
            && member.0 > using.0
            && owner[using.idx()] == owner[member.idx()]
        {
            return Evaluated::default();
        }
        self.get_enum_member_value(file, member)
    }
}

/// `EnumLiteralKey`: what two values of members of an enum are the same by. `0` and `-0` are, and there is one `NaN`.
fn enum_value_key(value: EnumValue) -> EnumValue {
    match value {
        EnumValue::Number(bits) if f64::from_bits(bits) == 0.0 => EnumValue::Number(0f64.to_bits()),
        EnumValue::Number(bits) if f64::from_bits(bits).is_nan() => {
            EnumValue::Number(f64::NAN.to_bits())
        }
        _ => value,
    }
}

/// `isVariadicTupleElement`: `...T` where `T` is not written as an array type.
pub(super) fn is_variadic_tuple_element(hir: &hir::File, elem: &TupleElem) -> bool {
    elem.rest && elem.ty.is_some() && array_element_type_node(hir, elem.ty).is_none()
}

/// Every declaration of `sym`, which is canonical: what `Files::decls` lists, one at a time.
pub(super) fn declarations_of(
    files: &Files,
    sym: Sym,
) -> impl Iterator<Item = (FileId, Decl)> + '_ {
    files.parts(sym).into_iter().flat_map(move |part| {
        files
            .symbol(part)
            .decls
            .iter()
            .map(move |&decl| (part.file, decl))
    })
}

impl<'p> Checker<'p> {
    // ───────────────────────────── type parameters in scope ─────────────────────────────

    /// The type parameters that can be mentioned in `scope`, outermost first.
    pub fn outer_type_params(&mut self, file: FileId, scope: ScopeId) -> Arc<[TypeId]> {
        if scope.is_none() {
            return Arc::from([]);
        }
        self.kept_outer_type_params(file, scope).clone()
    }

    /// The same, for whoever only looks at them.
    pub(super) fn type_params_in_scope(&mut self, file: FileId, scope: ScopeId) -> &'p [TypeId] {
        if scope.is_none() || self.declares_no_type_params(file) {
            return &[];
        }
        self.kept_outer_type_params(file, scope)
    }

    /// Whether no scope of `file` sees a type parameter, the `this` types of classes and interfaces included.
    #[inline]
    fn declares_no_type_params(&self, file: FileId) -> bool {
        let hir = self.hir(file);
        hir.type_params.is_empty() && hir.classes.is_empty() && hir.interfaces.is_empty()
    }

    fn kept_outer_type_params(&mut self, file: FileId, scope: ScopeId) -> &'p Arc<[TypeId]> {
        if let Some(known) = self.p.outer_type_params.get_ref(&(file, scope)) {
            return known;
        }
        let bound = self.bound(file);
        let s = &bound.scopes[scope.idx()];
        let outer = self.outer_type_params(file, s.parent);
        let mut own: Vec<(u32, TypeId)> = Vec::new();
        if matches!(
            s.kind,
            ScopeKind::Fn(_)
                | ScopeKind::Class(_)
                | ScopeKind::Interface(_)
                | ScopeKind::TypeParams
        ) {
            for &(_, symbol) in bound.table(s.locals) {
                let symbol = &bound.symbols[symbol.idx()];
                if !symbol.flags.contains(SymFlags::TYPE_PARAMETER) {
                    continue;
                }
                for decl in &symbol.decls {
                    if let Decl::TypeParam(tp) = *decl {
                        own.push((tp.0, self.type_param(file, tp)));
                    }
                }
            }
        }
        own.sort_unstable();
        let this = match s.kind {
            ScopeKind::Class(c) => Some(self.files().sym(file, bound.class_symbol[c.idx()])),
            ScopeKind::Interface(i) => {
                Some(self.files().sym(file, bound.interface_symbol[i.idx()]))
            }
            _ => None,
        };
        let result: Arc<[TypeId]> = if own.is_empty() && this.is_none() {
            outer
        } else {
            let mut all = outer.to_vec();
            all.extend(own.iter().map(|o| o.1));
            if let Some(this) = this {
                all.push(self.intern(TypeData::ThisParam(this)));
            }
            all.into()
        };
        self.p.outer_type_params.insert_ref((file, scope), result)
    }

    /// Every type parameter in scope, standing for itself.
    pub fn identity_mapper(&mut self, file: FileId, scope: ScopeId) -> MapperId {
        if scope.is_none() || self.declares_no_type_params(file) {
            return MapperId::IDENTITY;
        }
        if let Some(kept) = self.p.identity_mappers.get(&(file, scope)) {
            return kept;
        }
        let params = self.type_params_in_scope(file, scope);
        let mapper = if params.is_empty() {
            MapperId::IDENTITY
        } else {
            self.p
                .types
                .mapper(params.iter().map(|&p| (p, p)).collect())
        };
        self.p.identity_mappers.insert((file, scope), mapper)
    }

    /// `isTypeParameterPossiblyReferenced`: the type parameters in scope that `mentioned` has, or that count as mentioned for where
    /// they are declared, standing for themselves. A type that is written inside a generic declaration without referring to its
    /// parameters is not generic. `pos`: where it is written.
    fn identity_mapper_of_mentioned(
        &mut self,
        file: FileId,
        scope: ScopeId,
        pos: u32,
        mentioned: &Mentioned,
    ) -> MapperId {
        if mentioned.everything {
            return self.identity_mapper(file, scope);
        }
        let params = self.type_params_in_scope(file, scope);
        // The outermost come first, so those that count for where they are declared are the first so many.
        let mut taken = self.params_beyond_a_block(file, scope, pos);
        for &(of, declared_in) in &mentioned.values_in {
            let seen = self.type_params_in_scope(of, declared_in).len();
            // A declaration of the method in another file: what is seen from there is not what is seen from `scope`.
            if of != file && seen > 0 {
                return self.identity_mapper(file, scope);
            }
            taken = taken.max(seen);
        }
        let pairs: Vec<(TypeId, TypeId)> = params
            .iter()
            .copied()
            .enumerate()
            .filter(|&(i, p)| {
                i < taken
                    || match *self.data(p) {
                        TypeData::TypeParam(f, tp, _) => {
                            let id = self.bound(f).type_param_symbol[tp.idx()];
                            mentioned.type_params.contains(&Sym { file: f, id })
                                || !self.type_param_has_one_declaration(f, tp)
                        }
                        // `getDeclaredTypeOfClassOrInterface`: a class, and what is generic, has a `this` type.
                        TypeData::ThisParam(owner) => {
                            mentioned.this
                                || self.files().decls_of(owner).len() != 1
                                    && (self.files().flags(owner).contains(SymFlags::CLASS)
                                        || params[..i].iter().any(|&outer| {
                                            matches!(self.data(outer), TypeData::TypeParam(..))
                                        }))
                        }
                        _ => true,
                    }
            })
            .map(|(_, p)| (p, p))
            .collect();
        if pairs.is_empty() {
            MapperId::IDENTITY
        } else {
            self.p.types.mapper(pairs)
        }
    }

    /// `len(tp.symbol.Declarations) == 1`. `infer U` written twice is one symbol of its scope. The type parameters of a class or an
    /// interface are among its members.
    fn type_param_has_one_declaration(&self, file: FileId, tp: TypeParamId) -> bool {
        let bound = self.bound(file);
        let symbol = bound.type_param_symbol[tp.idx()];
        let declaration = crate::bind::MemberDeclaration::TypeParameter(tp);
        (symbol.is_none() || bound.symbols[symbol.idx()].decls.len() == 1)
            && self.files().declarations_of_member(file, declaration).len() == 1
    }

    fn type_param_names_in_scope(&mut self, file: FileId, scope: ScopeId) -> SmallVec<[Atom; 8]> {
        let params = self.type_params_in_scope(file, scope);
        params
            .iter()
            .filter_map(|&p| Some(self.type_param_decl(p)?.1.name))
            .collect()
    }

    /// How many of `outer_type_params(file, scope)`, which has the outermost first, have a statement block between where they are
    /// declared and `pos`: `isTypeParameterPossiblyReferenced` takes those to be referred to.
    fn params_beyond_a_block(&mut self, file: FileId, mut scope: ScopeId, pos: u32) -> usize {
        let (hir, bound) = (self.hir(file), self.bound(file));
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            match s.kind {
                ScopeKind::Block => return self.type_params_in_scope(file, scope).len(),
                ScopeKind::Fn(f) => {
                    // The body of a function shares its scope with the signature: told apart by where it starts.
                    if let FnBody::Block(stmts) = hir[f].body
                        && hir
                            .ids(stmts)
                            .next()
                            .is_some_and(|first| pos >= hir[first].pos)
                    {
                        return self.type_params_in_scope(file, scope).len();
                    }
                    // The scope that the name of a function expression has to itself is no block.
                    if hir[f].kind == FnKind::Expr && hir[f].name.is_some() {
                        scope = bound.scopes[s.parent.idx()].parent;
                        continue;
                    }
                }
                _ => {}
            }
            scope = s.parent;
        }
        0
    }

    /// `getAliasSymbolForTypeNode`: the type alias declaration whose body is `node`, which is written in `scope`. A `readonly`
    /// operator around `node` is skipped.
    pub(super) fn alias_with_body(
        &self,
        file: FileId,
        scope: ScopeId,
        node: TypeNodeId,
    ) -> Option<AliasId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !bound.type_by_alias[node.idx()]
            || bound.scopes[scope.idx()].kind != ScopeKind::TypeParams
        {
            return None;
        }
        let alias = AliasId(bound.alias_scope.iter().position(|&s| s == scope)? as u32);
        let mut body = hir[alias].ty;
        while body.is_some()
            && let TypeNodeKind::Readonly(operand) = hir[body].kind
        {
            body = operand;
        }
        (body == node).then_some(alias)
    }

    /// Whether `node`, written in `scope`, is the body of a type alias that has type parameters.
    fn is_body_of_generic_alias(&self, file: FileId, scope: ScopeId, node: TypeNodeId) -> bool {
        self.alias_with_body(file, scope, node)
            .is_some_and(|alias| !self.hir(file)[alias].type_params.is_empty())
    }

    /// The body of the type alias whose type parameters `scope` declares, if that is an intersection type node and `node` is the
    /// first of its members that keeps a mapper.
    fn intersection_alias_body_pinned_by(
        &self,
        file: FileId,
        scope: ScopeId,
        node: TypeNodeId,
    ) -> Option<TypeNodeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if bound.scopes[scope.idx()].kind != ScopeKind::TypeParams {
            return None;
        }
        let alias = AliasId(bound.alias_scope.iter().position(|&s| s == scope)? as u32);
        let body = hir[alias].ty;
        if body.is_none() {
            return None;
        }
        let TypeNodeKind::Intersection(types) = hir[body].kind else {
            return None;
        };
        let first = hir.ids(types).find(|&t| match hir[t].kind {
            TypeNodeKind::Fn(_) | TypeNodeKind::Mapped(_) | TypeNodeKind::Cond { .. } => true,
            TypeNodeKind::Object(members) => !members.is_empty(),
            _ => false,
        })?;
        (first == node).then_some(body)
    }

    pub(super) fn identity_mapper_for_node(
        &mut self,
        file: FileId,
        scope: ScopeId,
        node: TypeNodeId,
    ) -> MapperId {
        if self.type_params_in_scope(file, scope).is_empty() {
            return MapperId::IDENTITY;
        }
        // `getObjectTypeInstantiation`, `getTypeFromConditionalTypeNode`: what a generic alias stands for depends on all of them,
        // mentioned or not.
        if self.is_body_of_generic_alias(file, scope, node) {
            return self.identity_mapper(file, scope);
        }
        let mut mentioned = Mentioned {
            candidates: self.type_param_names_in_scope(file, scope),
            ..Mentioned::default()
        };
        self.collect_mentions(file, node, &mut mentioned);
        self.collect_mentions_of_extends_types_around(file, node, &mut mentioned);
        let mapper =
            self.identity_mapper_of_mentioned(file, scope, self.hir(file)[node].pos, &mentioned);
        // `getIntersectionType`: the alias and all its type arguments are part of the identity of the type (`getAliasKey`). Where the
        // body leaves out a type parameter, one member stands in for that.
        if let Some(body) = self.intersection_alias_body_pinned_by(file, scope, node) {
            self.collect_mentions(file, body, &mut mentioned);
            let all = self.identity_mapper(file, scope);
            let pos = self.hir(file)[body].pos;
            if self.identity_mapper_of_mentioned(file, scope, pos, &mentioned) != all {
                return all;
            }
        }
        mapper
    }

    /// The same for the declarations of a method. What a body returns can involve anything in scope.
    pub(super) fn identity_mapper_for_fns(
        &mut self,
        file: FileId,
        scope: ScopeId,
        decls: &[(FileId, FnId)],
    ) -> MapperId {
        if self.type_params_in_scope(file, scope).is_empty() {
            return MapperId::IDENTITY;
        }
        let mut mentioned = Mentioned {
            candidates: self.type_param_names_in_scope(file, scope),
            ..Mentioned::default()
        };
        for &(f, func) in decls {
            self.collect_fn_mentions(f, func, &mut mentioned);
            let bound = self.bound(f);
            if let crate::bind::FnOwner::Member(member) = bound.fns[func.idx()].owner
                && let crate::bind::MemberOwner::TypeLiteral(literal) =
                    bound.member_owner[member.idx()]
            {
                self.collect_mentions_of_extends_types_around(f, literal, &mut mentioned);
            }
        }
        let pos = decls
            .iter()
            .find(|d| d.0 == file)
            .map_or(0, |&(f, func)| self.hir(f)[func].pos);
        self.identity_mapper_of_mentioned(file, scope, pos, &mentioned)
    }

    /// `isTypeParameterPossiblyReferenced`, `IsConditionalTypeNode(n) && ForEachChild(n.ExtendsType, containsReference)` on the way
    /// up from `node`: what a conditional type checks against is in the substitution types below it.
    fn collect_mentions_of_extends_types_around(
        &self,
        file: FileId,
        mut node: TypeNodeId,
        out: &mut Mentioned,
    ) {
        let parents = self.type_parents(file);
        while let Some(&parent) = parents.get(node.idx())
            && parent.is_some()
        {
            if let TypeNodeKind::Cond { extends, .. } = self.hir(file)[parent].kind {
                self.collect_mentions(file, extends, out);
            }
            node = parent;
        }
    }

    fn collect_fn_mentions(&self, file: FileId, func: FnId, out: &mut Mentioned) {
        let hir = self.hir(file);
        let f = &hir[func];
        if !matches!(f.body, FnBody::None) && f.ret.is_none() {
            out.everything = true;
            return;
        }
        for tp in f.type_params.iter() {
            self.collect_mentions(file, hir[tp].constraint, out);
            self.collect_mentions(file, hir[tp].default, out);
        }
        for p in f.params.iter() {
            // Without an annotation, what it is comes from a default or from the context.
            if hir[p].ty.is_none() && !matches!(f.body, FnBody::None) {
                out.everything = true;
                return;
            }
            self.collect_mentions(file, hir[p].ty, out);
        }
        self.collect_mentions(file, f.this_ty, out);
        self.collect_mentions(file, f.ret, out);
    }

    fn collect_mentions(&self, file: FileId, node: TypeNodeId, out: &mut Mentioned) {
        if node.is_none() || out.everything {
            return;
        }
        let hir = self.hir(file);
        let list = |c: &Self, nodes: IdList<TypeNodeId>, out: &mut Mentioned| {
            for n in hir.ids(nodes) {
                c.collect_mentions(file, n, out);
            }
        };
        match hir[node].kind {
            TypeNodeKind::Error
            | TypeNodeKind::StringLit(_)
            | TypeNodeKind::NumberLit(_)
            | TypeNodeKind::BigIntLit { .. }
            | TypeNodeKind::BoolLit(_)
            | TypeNodeKind::UniqueSymbol => {}
            TypeNodeKind::Keyword(keyword) => out.this |= keyword == Keyword::This,
            TypeNodeKind::Ref { name, args } => {
                if name.len() == 1 {
                    let name = hir.ids(name).next().unwrap();
                    // `getSymbolFromTypeReference`: a type parameter declared further in can have the name of one further out.
                    if out.candidates.contains(&name) {
                        let bound = self.bound(file);
                        let scope = bound.type_scope[node.idx()];
                        let found = self.files().resolve_name(file, scope, name, SymFlags::TYPE);
                        if let Some(found) = found
                            && !out.type_params.contains(&found)
                        {
                            out.type_params.push(found);
                        }
                    }
                }
                list(self, args, out);
            }
            TypeNodeKind::Template { types, .. }
            | TypeNodeKind::Union(types)
            | TypeNodeKind::Intersection(types) => list(self, types, out),
            TypeNodeKind::Array(t) | TypeNodeKind::Keyof(t) | TypeNodeKind::Readonly(t) => {
                self.collect_mentions(file, t, out)
            }
            TypeNodeKind::Tuple(elems) => {
                for e in elems.iter() {
                    self.collect_mentions(file, hir[e].ty, out);
                }
            }
            TypeNodeKind::Fn(func) => self.collect_fn_mentions(file, func, out),
            TypeNodeKind::Object(members) => {
                for m in members.iter() {
                    self.collect_mentions(file, hir[m].ty, out);
                    if hir[m].func.is_some() {
                        self.collect_fn_mentions(file, hir[m].func, out);
                    }
                }
            }
            TypeNodeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => {
                for n in [check, extends, yes, no] {
                    self.collect_mentions(file, n, out);
                }
            }
            TypeNodeKind::Infer(tp) => {
                let declared = Sym {
                    file,
                    id: self.bound(file).type_param_symbol[tp.idx()],
                };
                if !out.type_params.contains(&declared) {
                    out.type_params.push(declared);
                }
                self.collect_mentions(file, hir[tp].constraint, out);
            }
            TypeNodeKind::Mapped(m) => {
                let mapped = &hir[m];
                self.collect_mentions(file, hir[mapped.param].constraint, out);
                self.collect_mentions(file, mapped.name_ty, out);
                self.collect_mentions(file, mapped.ty, out);
            }
            TypeNodeKind::IndexedAccess { obj, index } => {
                self.collect_mentions(file, obj, out);
                self.collect_mentions(file, index, out);
            }
            // `isTypeParameterPossiblyReferenced`: the type of a value can involve the type parameters around its declaration.
            TypeNodeKind::Typeof { args, expr, .. } => {
                list(self, args, out);
                if expr.is_none() {
                    out.everything = true;
                    return;
                }
                let root = first_identifier(hir, expr);
                // `typeof this.x`
                let ExprKind::Ident(name) = hir[root].kind else {
                    out.everything = true;
                    return;
                };
                let bound = self.bound(file);
                let symbol = bound.expr_symbol[root.idx()];
                // Nothing in the file declares it: no type parameter is around what does.
                if symbol.is_none() {
                    return;
                }
                let decls = &bound.symbols[symbol.idx()].decls;
                let mut scope = bound.type_scope[node.idx()];
                while scope.is_some() {
                    let s = &bound.scopes[scope.idx()];
                    // A function or a class is inside itself (`isNodeDescendantOf`).
                    let is_its_own = match s.kind {
                        ScopeKind::Fn(f) => decls.contains(&Decl::Fn(f)),
                        ScopeKind::Class(c) => decls.contains(&Decl::Class(c)),
                        _ => false,
                    };
                    let local = bound.lookup(s.locals, name);
                    let local = local.map(|it| bound.export_symbol_of_value_symbol_if_exported(it));
                    if is_its_own || local == Some(symbol) {
                        break;
                    }
                    scope = s.parent;
                }
                if scope.is_some() && !out.values_in.contains(&(file, scope)) {
                    out.values_in.push((file, scope));
                }
            }
            TypeNodeKind::Import { args, .. } => list(self, args, out),
            TypeNodeKind::Predicate { param, ty, .. } => {
                out.this |= param == known::this;
                self.collect_mentions(file, ty, out);
            }
        }
    }

    /// `getDeclaredTypeOfSymbol(getSymbolOfDeclaration(tp))`: the declarations of one symbol declare one type parameter (`infer T` twice
    /// in one `extends` type, `<A, A>`).
    pub(super) fn declared_type_of_type_parameter(
        &mut self,
        file: FileId,
        tp: TypeParamId,
    ) -> TypeId {
        let symbol = self.bound(file).type_param_symbol[tp.idx()];
        if symbol.is_none() {
            return self.type_param(file, tp);
        }
        let sym = self.files().sym(file, symbol);
        self.declared_type(sym)
    }

    /// `core.AppendIfUnique` in `getTypeParametersFromDeclaration` and `appendTypeParameters`: whether `tp` has the name, and so the
    /// symbol, of a type parameter before it in the list `params`.
    fn is_repeated_type_param(
        &self,
        file: FileId,
        params: Span<TypeParamId>,
        tp: TypeParamId,
    ) -> bool {
        let hir = self.hir(file);
        let name = hir[tp].name;
        name != Atom::NONE
            && name != known::empty
            && params
                .iter()
                .take_while(|&earlier| earlier != tp)
                .any(|earlier| hir[earlier].name == name)
    }

    /// The type parameter list of what has one declaration and no more.
    fn only_type_param_list(&self, sym: Sym) -> Option<(FileId, Span<TypeParamId>)> {
        let symbol = self.files().symbol(sym);
        let [decl] = symbol.decls[..] else {
            return None;
        };
        if symbol.flags.contains(SymFlags::MERGED) {
            return None;
        }
        let hir = self.hir(sym.file);
        let params = match decl {
            Decl::Class(c) => hir[c].type_params,
            Decl::Interface(i) => hir[i].type_params,
            Decl::Alias(a) => hir[a].type_params,
            _ => Span::EMPTY,
        };
        Some((sym.file, params))
    }

    /// The type parameter lists of the declarations of a class, an interface or an alias, those that have the name.
    fn type_param_lists(&self, sym: Sym) -> SmallVec<[(FileId, Span<TypeParamId>); 16]> {
        let flags = self.type_flags_of_symbol(sym);
        declarations_of(self.files(), sym)
            .filter_map(|(file, decl)| {
                let hir = self.hir(file);
                match decl {
                    Decl::Class(c) if flags.contains(SymFlags::CLASS) => {
                        Some((file, hir[c].type_params))
                    }
                    Decl::Interface(i) if flags.contains(SymFlags::INTERFACE) => {
                        Some((file, hir[i].type_params))
                    }
                    Decl::Alias(a) if flags.contains(SymFlags::TYPE_ALIAS) => {
                        Some((file, hir[a].type_params))
                    }
                    _ => None,
                }
            })
            .collect()
    }

    /// `getLocalTypeParametersOfClassOrInterfaceOrTypeAlias`: the type parameters of all the declarations of a class, an interface
    /// or an alias, in the order they are first met. Those of one name are one.
    pub fn type_params_of_symbol(&self, sym: Sym) -> Arc<[TypeId]> {
        Arc::from(&self.local_type_params_of_symbol(sym)[..])
    }

    /// The same, for whoever only looks at them.
    pub(super) fn local_type_params_of_symbol(&self, sym: Sym) -> SmallVec<[TypeId; 4]> {
        if let Some((file, params)) = self.only_type_param_list(sym) {
            return params
                .iter()
                .filter(|&tp| !self.is_repeated_type_param(file, params, tp))
                .map(|tp| self.type_param(file, tp))
                .collect();
        }
        let lists = self.type_param_lists(sym);
        if let [(file, params)] = lists[..] {
            return params
                .iter()
                .filter(|&tp| !self.is_repeated_type_param(file, params, tp))
                .map(|tp| self.type_param(file, tp))
                .collect();
        }
        // Each declaration has parameters of its own here. They are taken from one declaration as far as it has them, so that
        // what a constraint or a default mentions is among them: the one that has most, and of those the first that says what
        // the defaults are.
        let mut best: Option<(FileId, Span<TypeParamId>, bool)> = None;
        for &(file, params) in &lists {
            let hir = self.hir(file);
            let has_defaults = params.iter().any(|tp| hir[tp].default.is_some());
            if best.is_none_or(|(_, most, with_defaults)| {
                params.len() > most.len()
                    || params.len() == most.len() && has_defaults && !with_defaults
            }) {
                best = Some((file, params, has_defaults));
            }
        }
        let Some((best_file, best, _)) = best else {
            return SmallVec::new();
        };
        let mut all: SmallVec<[(Atom, TypeId); 4]> = SmallVec::new();
        for &(file, params) in &lists {
            for tp in params.iter() {
                let name = self.hir(file)[tp].name;
                if all.iter().any(|known| known.0 == name) {
                    continue;
                }
                let param = match best.iter().find(|&b| self.hir(best_file)[b].name == name) {
                    Some(b) => self.type_param(best_file, b),
                    None => self.type_param(file, tp),
                };
                all.push((name, param));
            }
        }
        all.into_iter().map(|known| known.1).collect()
    }

    /// The scope the declaration `i` of an interface opens.
    fn interface_scope(&self, file: FileId, i: InterfaceId) -> ScopeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let decl = &hir[i];
        // What is written in it knows where it is.
        let mut scope = if let Some(tp) = decl.type_params.iter().next() {
            bound.type_param_scope[tp.idx()]
        } else if let Some(base) = hir.ids(decl.extends).next() {
            bound.type_scope[base.idx()]
        } else {
            let of_member = |m: MemberId| {
                if hir[m].func.is_some() {
                    Some(bound.fns[hir[m].func.idx()].scope)
                } else if hir[m].ty.is_some() {
                    Some(bound.type_scope[hir[m].ty.idx()])
                } else {
                    None
                }
            };
            decl.members
                .iter()
                .find_map(of_member)
                .unwrap_or(ScopeId::NONE)
        };
        while scope.is_some() && bound.scopes[scope.idx()].kind != ScopeKind::Interface(i) {
            scope = bound.scopes[scope.idx()].parent;
        }
        if scope.is_some() {
            return scope;
        }
        bound
            .scopes
            .iter()
            .position(|s| s.kind == ScopeKind::Interface(i))
            .map_or(ScopeId::NONE, |at| ScopeId(at as u32))
    }

    /// `getOuterTypeParametersOfClassOrInterface`: the type parameters of what `sym` is declared inside of, outermost first, without
    /// the `this` types.
    pub fn outer_type_params_of_symbol(&mut self, sym: Sym) -> Arc<[TypeId]> {
        let symbol = self.files().symbol(sym);
        // What is put together from several places is at the top of a file or of a namespace in each.
        if symbol.flags.contains(SymFlags::MERGED) {
            return Arc::from([]);
        }
        let (file, bound) = (sym.file, self.bound(sym.file));
        // The class if it is one, or else the first declaration of the interface.
        let of_class = symbol.decls.iter().find_map(|d| match *d {
            Decl::Class(c) => Some(bound.class_scope[c.idx()]),
            _ => None,
        });
        let own = of_class.or_else(|| {
            symbol.decls.iter().find_map(|d| match *d {
                Decl::Interface(i) => Some(self.interface_scope(file, i)),
                _ => None,
            })
        });
        let Some(own) = own.filter(|scope| scope.is_some()) else {
            return Arc::from([]);
        };
        let all = self.outer_type_params(file, bound.scopes[own.idx()].parent);
        if !all
            .iter()
            .any(|&p| matches!(self.data(p), TypeData::ThisParam(_)))
        {
            return all;
        }
        all.iter()
            .copied()
            .filter(|&p| !matches!(self.data(p), TypeData::ThisParam(_)))
            .collect()
    }

    /// The type parameters that the `args` of a `TypeData::Ref` to `sym` go with: those around the declaration, then its own.
    pub fn all_type_params_of_symbol(&mut self, sym: Sym) -> Arc<[TypeId]> {
        Arc::from(&self.listed_type_params_of_symbol(sym)[..])
    }

    /// The same, for whoever only looks at them.
    pub(super) fn listed_type_params_of_symbol(&mut self, sym: Sym) -> List<'p, TypeId> {
        if self
            .files()
            .flags(sym)
            .intersects(SymFlags::CLASS | SymFlags::INTERFACE)
        {
            // The declared type has them for arguments.
            let declared = self.declared_type(sym);
            if let TypeData::Ref { args, .. } = self.data(declared) {
                return List::Kept(&args[..]);
            }
        }
        List::Own(self.local_type_params_of_symbol(sym).into_vec())
    }

    /// How many type arguments a reference to `sym` has to have at least, and can have at most.
    pub(super) fn type_argument_arity(&self, sym: Sym) -> (usize, usize) {
        if let Some((file, params)) = self.only_type_param_list(sym) {
            let hir = self.hir(file);
            return (
                params
                    .iter()
                    .rposition(|tp| hir[tp].default.is_none())
                    .map_or(0, |last| last + 1),
                params.len(),
            );
        }
        let lists = self.type_param_lists(sym);
        // `getMinTypeArgumentCount`, `hasTypeParameterDefault`: a parameter has a default if any of its declarations gives it one.
        let mut all: SmallVec<[(Atom, bool); 4]> = SmallVec::new();
        for (file, params) in lists {
            let hir = self.hir(file);
            for tp in params.iter() {
                let (name, has_default) = (hir[tp].name, hir[tp].default.is_some());
                match all.iter_mut().find(|known| known.0 == name) {
                    Some(known) => known.1 |= has_default,
                    None => all.push((name, has_default)),
                }
            }
        }
        (
            all.iter()
                .rposition(|known| !known.1)
                .map_or(0, |last| last + 1),
            all.len(),
        )
    }

    /// From the type parameters of one declaration of `sym` to those the symbol goes by: the ones of the same name.
    pub fn decl_params_mapper(
        &mut self,
        sym: Sym,
        file: FileId,
        params: Span<TypeParamId>,
    ) -> MapperId {
        if params.is_empty() {
            return MapperId::IDENTITY;
        }
        let canonical = self.local_type_params_of_symbol(sym);
        let mut pairs: Vec<(TypeId, TypeId)> = Vec::new();
        for tp in params.iter() {
            let own = self.type_param(file, tp);
            let name = self.hir(file)[tp].name;
            if let Some(target) = canonical.iter().copied().find(|&c| {
                self.type_param_decl(c)
                    .is_some_and(|(_, decl)| decl.name == name)
            }) && target != own
            {
                pairs.push((own, target));
            }
        }
        if pairs.is_empty() {
            MapperId::IDENTITY
        } else {
            self.p.types.mapper(pairs)
        }
    }

    pub(super) fn type_param_decl(&self, param: TypeId) -> Option<(FileId, &'p TypeParam)> {
        match *self.data(param) {
            TypeData::TypeParam(file, tp, _) => Some((file, &self.hir(file)[tp])),
            _ => None,
        }
    }

    /// `getConstraintOfTypeParameter`: what `param extends`. A constraint that comes back to the parameter is none.
    pub fn constraint_of_type_param(&mut self, param: TypeId) -> Option<TypeId> {
        if let Some(kept) = self.p.type_param_constraints.get(&param) {
            return kept;
        }
        if param == TypeId::MARKER_SUB {
            return Some(TypeId::MARKER_SUPER);
        }
        // `markerSubTypeForCheck`
        if param == TypeId::MARKER_SUB_FOR_CHECK {
            return Some(TypeId::MARKER_SUPER_FOR_CHECK);
        }
        match *self.data(param) {
            TypeData::ThisParam(sym) => Some(self.declared_type(sym)),
            TypeData::TypeParam(file, tp, around) => {
                let before = self.what_only_holds_for_now();
                let constraint = self.resolve_constraint_of_type_param(param, file, tp, around);
                if self.what_only_holds_for_now() == before
                    && self.is_constraint_settled(param, file, tp, around, constraint)
                {
                    self.p.type_param_constraints.insert(param, constraint);
                }
                constraint
            }
            _ => None,
        }
    }

    #[inline(never)]
    fn resolve_constraint_of_type_param(
        &mut self,
        param: TypeId,
        file: FileId,
        tp: TypeParamId,
        around: MapperId,
    ) -> Option<TypeId> {
        let constraint = self.constraint_from_type_param(param)?;
        if self.constraint_comes_back(param, constraint) {
            return None;
        }
        // `getTypeFromMappedTypeNode` resolves the constraint of its key as soon as the mapped type is made, so a cycle can
        // go through the key of a mapped type written in the constraint.
        if around == MapperId::IDENTITY
            && !self.hir(file).mapped.is_empty()
            && self.has_type_variables(constraint)
            && self.is_constraint_circular(file, tp)
        {
            return None;
        }
        Some(constraint)
    }

    /// Whether `constraint`, which is what `param` was just found to extend, was read from what is kept itself. A frame can be left
    /// without its answer being kept and without `what_only_holds_for_now` moving.
    fn is_constraint_settled(
        &self,
        param: TypeId,
        file: FileId,
        tp: TypeParamId,
        around: MapperId,
        constraint: Option<TypeId>,
    ) -> bool {
        if constraint.is_some_and(|constraint| !self.is_known(constraint)) {
            return false;
        }
        if around != MapperId::IDENTITY {
            let declared = self.type_param(file, tp);
            return self.p.type_param_constraints.get(&declared).is_some();
        }
        let (of, written, _) =
            self.type_param_declaration_with(file, tp, |p: &TypeParam| p.constraint);
        let node = self.hir(of)[written].constraint;
        if node.is_some() {
            return self.p.type_node_types.get(of, node.idx()).is_some();
        }
        constraint.is_none() || self.p.inferred_constraints.get(&param).is_some()
    }

    /// `getConstraintFromTypeParameter`: the same, whether or not it goes round in a circle.
    pub(super) fn constraint_from_type_param(&mut self, param: TypeId) -> Option<TypeId> {
        let TypeData::TypeParam(file, tp, around) = *self.data(param) else {
            return None;
        };
        // A fresh one extends what the declared one does, with what is around it filled in.
        if around != MapperId::IDENTITY {
            let declared = self.type_param(file, tp);
            let constraint = self.constraint_of_type_param(declared)?;
            let mapper = self.clone_mapper(file, tp, around);
            return Some(self.instantiate(constraint, mapper));
        }
        let (of, written, lists) =
            self.type_param_declaration_with(file, tp, |p: &TypeParam| p.constraint);
        let node = self.hir(of)[written].constraint;
        if node.is_none() {
            if self.bound(file).infer_positions.is_empty() {
                return None;
            }
            return self.inferred_type_param_constraint(param, file, tp);
        }
        let mut constraint = self.type_from_node(of, node);
        // To extend `any` is to extend nothing in particular. What a mapped type ranges over are keys all the same.
        if self.has_any_flag(constraint) && !self.is_error_type(constraint) {
            constraint = if self.hir(of).mapped.iter().any(|m| m.param == written) {
                self.union(&[TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL])
            } else {
                TypeId::UNKNOWN
            };
        }
        Some(match lists {
            Some((theirs, own)) => {
                self.in_terms_of_own_type_params(constraint, (of, theirs), (file, own))
            }
            None => constraint,
        })
    }

    /// `hasNonCircularBaseConstraint`, the other way round, as far as type parameters, unions and intersections lead.
    pub(super) fn constraint_comes_back(&mut self, param: TypeId, constraint: TypeId) -> bool {
        if !matches!(
            self.data(constraint),
            TypeData::TypeParam(..) | TypeData::Union(_) | TypeData::Intersection(_)
        ) || !self.has_type_variables(constraint)
        {
            return false;
        }
        let mut seen: SmallVec<[TypeId; 4]> = SmallVec::new();
        let mut todo: SmallVec<[TypeId; 8]> = SmallVec::new();
        todo.push(constraint);
        while let Some(t) = todo.pop() {
            if t == param {
                return true;
            }
            match self.data(t) {
                TypeData::Union(parts) | TypeData::Intersection(parts) => todo.extend(
                    parts
                        .iter()
                        .copied()
                        .filter(|&part| self.has_type_variables(part)),
                ),
                TypeData::TypeParam(..) if !seen.contains(&t) => {
                    seen.push(t);
                    // What the others extend is only looked at to see where it leads.
                    self.eager.push(self.stack.len());
                    let next = self.constraint_from_type_param(t);
                    self.eager.pop();
                    todo.extend(next);
                }
                _ => {}
            }
        }
        false
    }

    /// `getConstraintDeclaration`, `getResolvedTypeParameterDefault`: of all the declarations of the type parameter the first that
    /// has the `part` asked for, or else its own. Those of one name in the declarations of a class or an interface are one
    /// parameter: with one from another declaration come the type parameters of that declaration and of this one.
    fn type_param_declaration_with(
        &self,
        file: FileId,
        tp: TypeParamId,
        part: fn(&TypeParam) -> TypeNodeId,
    ) -> (
        FileId,
        TypeParamId,
        Option<(Span<TypeParamId>, Span<TypeParamId>)>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `infer U` written twice is one parameter.
        let symbol = bound.type_param_symbol[tp.idx()];
        if symbol.is_some() && bound.symbols[symbol.idx()].decls.len() > 1 {
            for &decl in &bound.symbols[symbol.idx()].decls {
                if let Decl::TypeParam(p) = decl
                    && part(&hir[p]).is_some()
                {
                    return (file, p, None);
                }
            }
        }
        let scope = bound.type_param_scope[tp.idx()];
        if scope.is_none() {
            return (file, tp, None);
        }
        let (owner, own) = match bound.scopes[scope.idx()].kind {
            ScopeKind::Interface(i) => (bound.interface_symbol[i.idx()], hir[i].type_params),
            ScopeKind::Class(c) => (bound.class_symbol[c.idx()], hir[c].type_params),
            _ => return (file, tp, None),
        };
        if owner.is_none() {
            return (file, tp, None);
        }
        let declared = &bound.symbols[owner.idx()];
        if declared.decls.len() < 2 && !declared.flags.contains(SymFlags::MERGED) {
            return (file, tp, None);
        }
        let name = hir[tp].name;
        for (of, decl) in declarations_of(self.files(), self.files().sym(file, owner)) {
            let other = self.hir(of);
            let theirs = match decl {
                Decl::Class(c) => other[c].type_params,
                Decl::Interface(i) => other[i].type_params,
                _ => continue,
            };
            if let Some(p) = theirs
                .iter()
                .find(|&p| other[p].name == name && part(&other[p]).is_some())
            {
                return if (of, p) == (file, tp) {
                    (file, tp, None)
                } else {
                    (of, p, Some((theirs, own)))
                };
            }
        }
        (file, tp, None)
    }

    /// What one declaration of a class or an interface says of `theirs`, its type parameters, said of `own`, those of another:
    /// they are the same by name.
    fn in_terms_of_own_type_params(
        &mut self,
        ty: TypeId,
        theirs: (FileId, Span<TypeParamId>),
        own: (FileId, Span<TypeParamId>),
    ) -> TypeId {
        if !self.has_type_variables(ty) {
            return ty;
        }
        let mut pairs = Vec::with_capacity(theirs.1.len());
        for p in theirs.1.iter() {
            let name = self.hir(theirs.0)[p].name;
            if let Some(q) = own.1.iter().find(|&q| self.hir(own.0)[q].name == name) {
                pairs.push((self.type_param(theirs.0, p), self.type_param(own.0, q)));
            }
        }
        let mapper = self.p.types.mapper(pairs);
        self.instantiate(ty, mapper)
    }

    /// `instantiateSignatureEx`, the mapper a fresh type parameter is given: what `around` says, and for the type parameters
    /// declared along with `tp` the fresh ones.
    fn clone_mapper(&self, file: FileId, tp: TypeParamId, around: MapperId) -> MapperId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let scope = bound.type_param_scope[tp.idx()];
        let list = match scope.is_some().then(|| bound.scopes[scope.idx()].kind) {
            Some(ScopeKind::Fn(f)) => hir[f].type_params,
            _ => Span::new(tp.0, 1),
        };
        let fresh: SmallVec<[(TypeId, TypeId); 4]> = list
            .iter()
            .map(|t| {
                let declared = self.type_param(file, t);
                (declared, self.cloned_type_param(file, t, around))
            })
            .collect();
        let mapping = self.p.types.mapping(around);
        let mut pairs = Vec::with_capacity(mapping.len() + fresh.len());
        pairs.extend(
            mapping
                .iter()
                .copied()
                .filter(|p| !fresh.iter().any(|f| f.0 == p.0)),
        );
        pairs.extend_from_slice(&fresh);
        self.p.types.mapper(pairs)
    }

    /// `getInferredTypeParameterConstraint`: what follows for `infer T` from where it is written.
    #[inline(never)]
    fn inferred_type_param_constraint(
        &mut self,
        param: TypeId,
        file: FileId,
        tp: TypeParamId,
    ) -> Option<TypeId> {
        use crate::bind::InferPosition;
        let bound = self.bound(file);
        let symbol = bound.type_param_symbol[tp.idx()];
        if symbol.is_none() {
            return None;
        }
        let position_of = |p: TypeParamId| {
            bound
                .infer_positions
                .binary_search_by_key(&p, |e| e.0)
                .ok()
                .map(|i| bound.infer_positions[i].1)
        };
        let decls = &bound.symbols[symbol.idx()].decls;
        if !decls
            .iter()
            .any(|d| matches!(*d, Decl::TypeParam(p) if position_of(p).is_some()))
        {
            return None;
        }
        if let Some(known) = self.p.inferred_constraints.get(&param) {
            return known;
        }
        if !self.enter(Query::InferredConstraint(param)) {
            return None;
        }
        let mut inferences = Vec::new();
        for &decl in decls {
            let Decl::TypeParam(p) = decl else { continue };
            match position_of(p) {
                Some(InferPosition::TypeArgument(node, index)) => {
                    let hir = self.hir(file);
                    let TypeNodeKind::Ref { name, args } = hir[node].kind else {
                        continue;
                    };
                    let names: SmallVec<[Atom; 4]> = hir.ids(name).collect();
                    let Some(sym) = self.files().resolve_entity(
                        file,
                        bound.type_scope[node.idx()],
                        &names,
                        SymFlags::TYPE,
                    ) else {
                        continue;
                    };
                    let Some(sym) = self.files().resolve_alias_as(sym, SymFlags::TYPE) else {
                        continue;
                    };
                    // `getTypeParametersForTypeReferenceOrImport`
                    let reference = self.type_from_node(file, node);
                    if self.is_error_type(reference) {
                        continue;
                    }
                    let params = self.local_type_params_of_symbol(sym);
                    let Some(&target) = params.get(index as usize) else {
                        continue;
                    };
                    let Some(declared) = self.constraint_of_type_param(target) else {
                        continue;
                    };
                    // `newDeferredTypeMapper`: the type arguments are not looked at unless the constraint mentions a type parameter.
                    let constraint = if self.has_type_variables(declared) {
                        let given = self.types_from_nodes(file, args);
                        let filled = self.fill_type_args(&params, &given);
                        let mapper = self.mapper_from(&params, &filled);
                        self.instantiate(declared, mapper)
                    } else {
                        declared
                    };
                    // `U extends T` in `Foo<infer X, infer X>` says that X extends X.
                    if constraint != param {
                        inferences.push(constraint);
                    }
                }
                Some(InferPosition::Rest) => inferences.push(self.array_of(TypeId::UNKNOWN)),
                Some(InferPosition::Template) => inferences.push(TypeId::STRING),
                Some(InferPosition::MappedKey) => {
                    inferences.push(self.union(&[TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL]))
                }
                // `{ [K in X]: E } extends { [_ in Y]: infer T } ? ..`: `E`, with all that `K` ranges over in the place of `K`.
                Some(InferPosition::MappedTemplate(checked)) => {
                    let mapped = self.hir(file)[checked];
                    let template = self.type_from_node(file, mapped.ty);
                    let key = self.type_param(file, mapped.param);
                    let over = match self.hir(file)[mapped.param].constraint {
                        written if written.is_some() => self.type_from_node(file, written),
                        _ => self.union(&[TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL]),
                    };
                    let mapper = self.mapper_from(&[key], &[over]);
                    inferences.push(self.instantiate(template, mapper));
                }
                None => {}
            }
        }
        let holds = self.leave();
        let constraint = if inferences.is_empty() {
            None
        } else {
            Some(self.intersection(&inferences))
        };
        if holds {
            self.p.inferred_constraints.insert(param, constraint);
        }
        constraint
    }

    /// `getDefaultFromTypeParameter`
    pub fn default_of_type_param(&mut self, param: TypeId) -> Option<TypeId> {
        if let Some(kept) = self.p.type_param_defaults.get(&param) {
            return kept;
        }
        let TypeData::TypeParam(file, tp, around) = *self.data(param) else {
            return None;
        };
        let before = self.what_only_holds_for_now();
        let (default, is_settled) = self.resolve_default_of_type_param(file, tp, around);
        if is_settled
            && self.what_only_holds_for_now() == before
            && default.is_none_or(|default| self.is_known(default))
        {
            self.p.type_param_defaults.insert(param, default);
        }
        default
    }

    /// With it, whether it was read from what is kept itself. A frame can be left without its answer being kept and without
    /// `what_only_holds_for_now` moving.
    #[inline(never)]
    fn resolve_default_of_type_param(
        &mut self,
        file: FileId,
        tp: TypeParamId,
        around: MapperId,
    ) -> (Option<TypeId>, bool) {
        // That of a fresh one is that of the declared one, with what is around it filled in.
        if around != MapperId::IDENTITY {
            let declared = self.type_param(file, tp);
            let default = self.default_of_type_param(declared);
            let is_settled = self.p.type_param_defaults.get(&declared).is_some();
            let Some(default) = default else {
                return (None, is_settled);
            };
            let mapper = self.clone_mapper(file, tp, around);
            return (Some(self.instantiate(default, mapper)), is_settled);
        }
        let (of, written, lists) =
            self.type_param_declaration_with(file, tp, |p: &TypeParam| p.default);
        let node = self.hir(of)[written].default;
        if node.is_none() {
            return (None, true);
        }
        let default = self.type_from_node(of, node);
        let is_settled = self.p.type_node_types.get(of, node.idx()).is_some();
        let default = match lists {
            Some((theirs, own)) => {
                self.in_terms_of_own_type_params(default, (of, theirs), (file, own))
            }
            None => default,
        };
        (Some(default), is_settled)
    }

    /// The same for the type parameters of `sig`, whose defaults may mention those of what it was found in.
    pub fn fill_sig_type_args(
        &mut self,
        sig: SigId,
        params: &[TypeId],
        args: &[TypeId],
    ) -> Vec<TypeId> {
        self.fill_sig_type_args_as(sig, params, args, false)
    }

    /// `is_js`: see `fill_type_args_as`.
    pub fn fill_sig_type_args_as(
        &mut self,
        sig: SigId,
        params: &[TypeId],
        args: &[TypeId],
        is_js: bool,
    ) -> Vec<TypeId> {
        let mut filled = self.fill_type_args_as(params, args, is_js);
        if let Some((_, _, outer)) = self.sig_decl(sig) {
            for (ty, &param) in filled.iter_mut().zip(params).skip(args.len()) {
                // The default of a fresh parameter has them filled in already.
                if matches!(*self.data(param), TypeData::TypeParam(_, _, around) if around == MapperId::IDENTITY)
                {
                    *ty = self.instantiate(*ty, outer);
                }
            }
        }
        filled
    }

    /// `fillMissingTypeArguments`: `args`, with defaults for the parameters that were not given one.
    pub fn fill_type_args(&mut self, params: &[TypeId], args: &[TypeId]) -> Vec<TypeId> {
        self.fill_type_args_as(params, args, false)
    }

    /// `is_js` (`isJavaScriptImplicitAny`): a missing argument is `any` if its parameter has no default, or a default identical
    /// to `unknown` or `{}`.
    pub fn fill_type_args_as(
        &mut self,
        params: &[TypeId],
        args: &[TypeId],
        is_js: bool,
    ) -> Vec<TypeId> {
        let given = args.len().min(params.len());
        let mut filled: Vec<TypeId> = Vec::with_capacity(params.len());
        filled.extend_from_slice(&args[..given]);
        // Invalid forward references in default types are mapped to the error type.
        filled.resize(params.len(), TypeId::ERROR);
        for i in given..params.len() {
            filled[i] = match self.default_of_type_param(params[i]) {
                Some(default)
                    if is_js
                        && (default == TypeId::UNKNOWN
                            || self.is_identical(default, TypeId::EMPTY_OBJECT)) =>
                {
                    TypeId::ANY
                }
                Some(default) => {
                    let mapper = self.mapper_from(params, &filled);
                    self.instantiate(default, mapper)
                }
                None if is_js => TypeId::ANY,
                None => TypeId::UNKNOWN,
            };
        }
        filled
    }

    // ───────────────────────────── declared types of symbols ─────────────────────────────

    /// What `sym` means where a type is expected.
    #[inline]
    pub fn declared_type(&mut self, sym: Sym) -> TypeId {
        if let Some(known) = self.p.declared_types.get(&sym) {
            return known;
        }
        self.resolve_declared_type(sym)
    }

    #[inline(never)]
    fn resolve_declared_type(&mut self, sym: Sym) -> TypeId {
        if !self.enter(Query::Declared(sym)) {
            return if self.came_full_circle {
                TypeId::ERROR
            } else {
                TypeId::UNRESOLVED
            };
        }
        let ty = self.declared_type_uncached(sym);
        let holds = self.leave();
        // `getDeclaredTypeOfTypeAlias`: `popTypeResolution` fails.
        if self.left_a_circle {
            self.p.circular_aliases.insert(sym, ());
            return self.p.declared_types.insert(sym, TypeId::ERROR);
        }
        if holds {
            self.p.declared_types.insert(sym, ty);
        }
        ty
    }

    /// Of declarations that cannot be one symbol, the class or the interface among them has this to itself, whichever has the name.
    fn declared_type_uncached(&mut self, sym: Sym) -> TypeId {
        let flags = self.files().flags(sym);
        self.declared_type_as(sym, flags)
    }

    /// `declareSymbolEx`, `mergeSymbol`: a declaration that is excluded by what the name already is stays out of the symbol, and so
    /// does all that another file declares under the name if any of it is. Here they are one symbol all the same: the flags of
    /// `sym` without the kinds of type that stayed out.
    pub(super) fn type_flags_of_symbol(&self, sym: Sym) -> SymFlags {
        let flags = self.files().flags(sym);
        let object = SymFlags::CLASS | SymFlags::INTERFACE;
        let kinds = u8::from(flags.intersects(object))
            + u8::from(flags.contains(SymFlags::TYPE_ALIAS))
            + u8::from(flags.contains(SymFlags::ENUM))
            + u8::from(flags.contains(SymFlags::TYPE_PARAMETER));
        if kinds < 2 {
            return flags;
        }
        let has = self.flags_that_have_the_name(sym);
        flags.difference(
            (object | SymFlags::TYPE_ALIAS | SymFlags::ENUM | SymFlags::TYPE_PARAMETER)
                .difference(has),
        )
    }

    /// `declareSymbolEx`, `mergeSymbol`: the flags of the declarations of `sym` that no earlier declaration excludes.
    pub(super) fn flags_that_have_the_name(&self, sym: Sym) -> SymFlags {
        let object = SymFlags::CLASS | SymFlags::INTERFACE;
        let (value, ty) = (SymFlags::VALUE, SymFlags::TYPE);
        let mut has = SymFlags::empty();
        for part in self.files().parts(sym) {
            let (hir, bound) = (self.hir(part.file), self.bound(part.file));
            // What one file makes of the name, and what cannot be one with that (`getExcludedSymbolFlags`).
            let (mut makes, mut refuses) = (SymFlags::empty(), SymFlags::empty());
            for &decl in &self.files().symbol(part).decls {
                // What it makes the name, and its `SymbolFlags..Excludes`.
                let (adds, excludes) = match decl {
                    Decl::Var(mut pat) => {
                        while let PatParent::Prop(outer, _) | PatParent::Elem(outer, _) =
                            bound.pat_parent[pat.idx()]
                        {
                            pat = outer;
                        }
                        match bound.pat_parent[pat.idx()] {
                            PatParent::Var(d) if matches!(hir[d].kind, VarKind::Var) => (
                                SymFlags::FUNCTION_SCOPED_VARIABLE,
                                value.difference(SymFlags::FUNCTION_SCOPED_VARIABLE),
                            ),
                            _ => (SymFlags::BLOCK_SCOPED_VARIABLE, value),
                        }
                    }
                    Decl::Param(_) => (SymFlags::FUNCTION_SCOPED_VARIABLE, value),
                    Decl::Fn(_) => (
                        SymFlags::FUNCTION,
                        value.difference(
                            SymFlags::FUNCTION | SymFlags::VALUE_MODULE | SymFlags::CLASS,
                        ),
                    ),
                    Decl::Class(_) => (
                        SymFlags::CLASS,
                        (value | ty).difference(
                            SymFlags::VALUE_MODULE | SymFlags::INTERFACE | SymFlags::FUNCTION,
                        ),
                    ),
                    Decl::Interface(_) => (SymFlags::INTERFACE, ty.difference(object)),
                    Decl::Alias(_) => (SymFlags::TYPE_ALIAS, ty),
                    // There is one flag for both kinds of enum: that the one excludes the other is not seen.
                    Decl::Enum(e) if hir[e].flags.contains(Flags::CONST) => {
                        (SymFlags::ENUM, (value | ty).difference(SymFlags::ENUM))
                    }
                    Decl::Enum(_) => (
                        SymFlags::ENUM,
                        (value | ty).difference(SymFlags::ENUM | SymFlags::VALUE_MODULE),
                    ),
                    Decl::Module(m) if bound.module_instantiated[m.idx()] => (
                        SymFlags::VALUE_MODULE,
                        value.difference(
                            SymFlags::FUNCTION
                                | SymFlags::CLASS
                                | SymFlags::ENUM
                                | SymFlags::VALUE_MODULE,
                        ),
                    ),
                    Decl::TypeParam(_) => (
                        SymFlags::TYPE_PARAMETER,
                        ty.difference(SymFlags::TYPE_PARAMETER),
                    ),
                    _ => continue,
                };
                if !makes.intersects(excludes) {
                    makes |= adds;
                    refuses |= excludes;
                }
            }
            if !has.intersects(refuses) {
                has |= makes;
            }
        }
        has
    }

    /// What the name `sym` means where a type is expected. `flags`: its `type_flags_of_symbol`.
    fn declared_type_by_name(&mut self, sym: Sym, flags: SymFlags) -> TypeId {
        if flags == self.files().flags(sym) {
            self.declared_type(sym)
        } else {
            self.declared_type_as(sym, flags)
        }
    }

    /// `getDeclaredTypeOfSymbol`, of `sym` taken for what `flags` say it is.
    fn declared_type_as(&mut self, sym: Sym, flags: SymFlags) -> TypeId {
        if flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE) {
            // `getDeclaredTypeOfClassOrInterface`: a reference to itself, with the type parameters around it and its own for arguments.
            let outer = self.outer_type_params_of_symbol(sym);
            // Those of a class or an interface that does not have the name stand for themselves.
            let has_the_name = self
                .type_flags_of_symbol(sym)
                .intersects(SymFlags::CLASS | SymFlags::INTERFACE);
            let local = if has_the_name {
                self.local_type_params_of_symbol(sym)
            } else {
                SmallVec::new()
            };
            let args: Box<[TypeId]> = outer.iter().chain(local.iter()).copied().collect();
            return self.intern(TypeData::Ref { target: sym, args });
        }
        if flags.contains(SymFlags::TYPE_ALIAS) {
            for (file, decl) in declarations_of(self.files(), sym) {
                if let Decl::Alias(a) = decl {
                    return self.type_from_node(file, self.hir(file)[a].ty);
                }
            }
        }
        if flags.contains(SymFlags::ENUM) {
            return self.enum_type(sym);
        }
        if flags.contains(SymFlags::ENUM_MEMBER) {
            return self.enum_member_type(sym);
        }
        if flags.contains(SymFlags::TYPE_PARAMETER) {
            for (file, decl) in declarations_of(self.files(), sym) {
                if let Decl::TypeParam(tp) = decl {
                    return self.type_param(file, tp);
                }
            }
        }
        TypeId::UNRESOLVED
    }

    /// `getDeclaredTypeOfEnum`: the union of the types of its members. An enum without members is a type of its own.
    pub fn enum_type(&mut self, sym: Sym) -> TypeId {
        let mut members = Vec::new();
        let mut values = crate::util::FxHashSet::default();
        for (file, decl) in declarations_of(self.files(), sym) {
            let Decl::Enum(e) = decl else { continue };
            for m in self.hir(file)[e].members.iter() {
                // `hasBindableName`
                if self.hir(file)[m].name.is_none() {
                    continue;
                }
                let member = self
                    .files()
                    .sym(file, self.bound(file).enum_member_symbol[m.idx()]);
                match self.enum_member_value(file, m) {
                    // `getEnumLiteralType`: the members that have one value are one type, which goes by the first of them.
                    Some(value) => {
                        if values.insert(enum_value_key(value)) {
                            members.push(self.intern(TypeData::EnumLit {
                                member,
                                value,
                                fresh: false,
                            }));
                        }
                    }
                    // `createComputedEnumType`
                    None => members.push(self.intern(TypeData::Enum {
                        symbol: member,
                        fresh: false,
                    })),
                }
            }
        }
        if members.is_empty() {
            return self.intern(TypeData::Enum {
                symbol: sym,
                fresh: false,
            });
        }
        self.union(&members)
    }

    /// `getBaseTypeOfEnumLikeType`: the enum `member` is a member of.
    pub fn enum_type_of_member(&mut self, member: Sym) -> TypeId {
        let parent = self.files().symbol(member).parent;
        if parent.is_none() {
            return TypeId::NUMBER;
        }
        let parent = self.files().sym(member.file, parent);
        // Whichever has the name, a class, an interface or an alias declared under it comes first in `declared_type`.
        if self
            .files()
            .flags(parent)
            .intersects(SymFlags::CLASS | SymFlags::INTERFACE | SymFlags::TYPE_ALIAS)
        {
            return self.enum_type(parent);
        }
        self.declared_type(parent)
    }

    /// `getDeclaredTypeOfEnumMember`, in its regular form.
    pub fn enum_member_type(&mut self, member: Sym) -> TypeId {
        for (file, decl) in declarations_of(self.files(), member) {
            if let Decl::EnumMember(m) = decl {
                // `getDeclaredTypeOfEnum` passes over a member without a bindable name (`hasBindableName`), which is left with the
                // type of the enum.
                if self.hir(file)[m].name.is_none() {
                    return self.enum_type_of_member(member);
                }
                // `createComputedEnumType`: what has no value is a type of its own.
                let Some(value) = self.enum_member_value(file, m) else {
                    return self.intern(TypeData::Enum {
                        symbol: member,
                        fresh: false,
                    });
                };
                // `getEnumLiteralType`: the type the enum has for the value.
                let key = enum_value_key(value);
                let owner = self.enum_type_of_member(member);
                let shared =
                    self.parts(owner)
                        .iter()
                        .copied()
                        .find(|&part| match *self.data(part) {
                            TypeData::EnumLit { value, .. } => enum_value_key(value) == key,
                            _ => false,
                        });
                return shared.unwrap_or_else(|| {
                    self.intern(TypeData::EnumLit {
                        member,
                        value,
                        fresh: false,
                    })
                });
            }
        }
        TypeId::UNRESOLVED
    }

    pub fn enum_member_value(&mut self, file: FileId, member: EnumMemberId) -> Option<EnumValue> {
        self.get_enum_member_value(file, member).value
    }

    /// `getEnumMemberValue`
    pub(super) fn get_enum_member_value(
        &mut self,
        file: FileId,
        member: EnumMemberId,
    ) -> Evaluated {
        if let Some(known) = self.p.enum_values.get(&(file, member)) {
            return known;
        }
        if !self.enter(Query::Enum(file, member)) {
            return Evaluated::default();
        }
        let hir = self.hir(file);
        let value = if hir[member].init.is_some() {
            self.evaluate(file, hir[member].init, Location::Member(file, member))
        } else {
            let owner = self.bound(file).enum_member_owner[member.idx()];
            let flags = hir[owner].flags;
            // `computeEnumMemberValue`: what an ambient enum that is not `const` does not say is computed.
            if (flags.contains(Flags::AMBIENT) || hir.kind == FileKind::Declaration)
                && !flags.contains(Flags::CONST)
            {
                Evaluated::default()
            } else if hir[owner].members.start == member.0 {
                Evaluated::number(0.0)
            } else {
                match self.enum_member_value(file, EnumMemberId(member.0 - 1)) {
                    Some(EnumValue::Number(bits)) => Evaluated::number(f64::from_bits(bits) + 1.0),
                    _ => Evaluated::default(),
                }
            }
        };
        if self.leave() {
            self.p.enum_values.insert((file, member), value);
        }
        value
    }

    /// `evaluate(e, e)`: what `e` comes to, if it is made of nothing but literals, enum members and constants that are.
    pub(super) fn constant_value(&mut self, file: FileId, e: ExprId) -> Option<EnumValue> {
        self.evaluate(file, e, Location::Expr(file, e)).value
    }

    fn constant_text(&self, value: EnumValue) -> &'p [u8] {
        let atom = match value {
            EnumValue::String(s) => s,
            EnumValue::Number(bits) => self.number_name(f64::from_bits(bits)),
        };
        self.files().atoms.bytes(atom)
    }

    /// `isConstantVariable(symbol)` and what `evaluateEntity` asks of its `ValueDeclaration`: a constant declared by name, its type left to
    /// its initializer, before `location`.
    fn constant_variable_declaration(
        &self,
        symbol: Sym,
        location: Location,
    ) -> Option<(FileId, VarDeclId)> {
        let files = self.files();
        let flags = files.flags(symbol);
        if !flags.intersects(SymFlags::VARIABLE) || !flags.contains(SymFlags::CONST) {
            return None;
        }
        let declarations = files.decls_of(symbol);
        let (of, pat) = declarations.iter().find_map(|&(of, decl)| match decl {
            Decl::Var(pat) => Some((of, pat)),
            _ => None,
        })?;
        let PatParent::Var(d) = self.bound(of).pat_parent[pat.idx()] else {
            return None;
        };
        let declaration = &self.hir(of)[d];
        let declared = Location::Variable(of, d);
        (declaration.ty.is_none()
            && declaration.init.is_some()
            && declared != location
            && is_declared_before_use(self, declared, location))
        .then_some((of, d))
    }

    /// `resolveEntityName(e, meaning, ignoreErrors)`, of `e` without the parentheses around it: namespaces up to the last name. `None`
    /// too if that is no `IsEntityNameExpression`, as `(a).b` is none.
    pub(super) fn resolve_entity_name_expression(
        &self,
        file: FileId,
        e: ExprId,
        meaning: SymFlags,
    ) -> Option<Sym> {
        let hir = self.hir(file);
        let found = match hir[e].kind {
            // `resolveName(e, name, meaning)`. The binder has what an identifier means as a value.
            ExprKind::Ident(name) if meaning == SymFlags::VALUE => {
                self.symbol_of_identifier(file, e, name)?
            }
            ExprKind::Ident(name) => {
                let scope = self.enclosing_scope_of_expr(file, e);
                self.files().resolve_name(file, scope, name, meaning)?
            }
            ExprKind::Dot { obj, name, .. } if !is_parenthesized(hir, obj) => {
                let namespace =
                    self.resolve_entity_name_expression(file, obj, SymFlags::NAMESPACE)?;
                self.files().namespace_member(namespace, name)?
            }
            _ => return None,
        };
        let sym = self.files().resolve_alias_as(found, meaning)?;
        self.files().flags(sym).intersects(meaning).then_some(sym)
    }

    // ───────────────────────────── type syntax ─────────────────────────────

    pub fn types_from_nodes(&mut self, file: FileId, nodes: IdList<TypeNodeId>) -> Vec<TypeId> {
        let hir = self.hir(file);
        hir.ids(nodes)
            .map(|n| self.type_from_node(file, n))
            .collect()
    }

    /// The type `node` denotes, with the type parameters in scope standing for themselves.
    #[inline]
    pub fn type_from_node(&mut self, file: FileId, node: TypeNodeId) -> TypeId {
        if node.is_none() {
            return TypeId::UNRESOLVED;
        }
        if let Some(known) = self.p.type_node_types.get(file, node.idx()) {
            return known;
        }
        self.resolve_type_from_node(file, node)
    }

    #[inline(never)]
    fn resolve_type_from_node(&mut self, file: FileId, node: TypeNodeId) -> TypeId {
        if !self.enter(Query::TypeNode(file, node)) {
            // `getTypeFromTypeNode` does not detect re-entry: tsgo recurses until it hits an instantiation limit.
            return self.excessively_deep();
        }
        let ty = self.type_from_node_uncached(file, node);
        let ty = self.conditional_flow_type_of_type(file, ty, node);
        let ty = self.with_alias_for_type_node(file, node, ty);
        if self.leave() {
            self.p.type_node_types.set(file, node.idx(), ty);
        }
        ty
    }

    /// `getIntendedTypeFromJSDocTypeReference`, of a name with type arguments, which `checkNoTypeArguments` objects to.
    fn jsdoc_primitive_with_type_arguments(
        &mut self,
        file: FileId,
        node: TypeNodeId,
    ) -> Option<TypeId> {
        let hir = self.hir(file);
        let TypeNodeKind::Ref { name, args } = hir[node].kind else {
            return None;
        };
        if args.is_empty() || name.len() != 1 || !hir.is_in_jsdoc(hir[node].pos) {
            return None;
        }
        Some(match self.files().atoms.bytes(hir.id_at(name, 0)) {
            b"String" => TypeId::STRING,
            b"Number" => TypeId::NUMBER,
            b"BigInt" => TypeId::BIGINT,
            b"Boolean" => TypeId::BOOLEAN,
            b"Void" => TypeId::VOID,
            b"Undefined" => self.undefined_as_declared(),
            b"Null" if self.p.files.options.strict_null_checks => TypeId::NULL,
            b"Null" => TypeId::NULL_DECLARED,
            b"Function" | b"function" => self.global_ref(known::Function, &[]),
            _ => return None,
        })
    }

    fn type_from_node_uncached(&mut self, file: FileId, node: TypeNodeId) -> TypeId {
        let hir = self.hir(file);
        let scope = self.bound(file).type_scope[node.idx()];
        match hir[node].kind {
            TypeNodeKind::Error => TypeId::UNRESOLVED,
            TypeNodeKind::Keyword(k) => match k {
                Keyword::Any => TypeId::ANY,
                Keyword::Unknown => TypeId::UNKNOWN,
                Keyword::Never => TypeId::NEVER,
                Keyword::Void => TypeId::VOID,
                // `undefinedType`, `nullType`: written as a type they are never widened.
                Keyword::Undefined => self.undefined_as_declared(),
                Keyword::Null if self.p.files.options.strict_null_checks => TypeId::NULL,
                Keyword::Null => TypeId::NULL_DECLARED,
                Keyword::String => TypeId::STRING,
                Keyword::Number => TypeId::NUMBER,
                Keyword::Boolean => TypeId::BOOLEAN,
                Keyword::BigInt => TypeId::BIGINT,
                Keyword::Symbol => TypeId::SYMBOL,
                Keyword::Object => TypeId::OBJECT,
                // `intrinsicMarkerType`: where it does not stand for something built in, it can be anything.
                Keyword::Intrinsic => TypeId::ANY,
                Keyword::This => self.this_type_at(file, node, scope),
            },
            TypeNodeKind::StringLit(value) => self.string_literal(value, false),
            TypeNodeKind::NumberLit(n) => self.number_literal(hir.numbers[n as usize], false),
            TypeNodeKind::BigIntLit { text, negative } => {
                // `NewPseudoBigInt`: zero has no sign.
                let digits = self.files().atoms.bytes(text);
                let negative = negative && !digits.iter().all(|&c| c == b'0' || c == b'n');
                self.intern(TypeData::BigIntLit {
                    text,
                    negative,
                    fresh: false,
                })
            }
            TypeNodeKind::BoolLit(value) => self.bool_literal(value, false),
            TypeNodeKind::UniqueSymbol => TypeId::SYMBOL,
            // `getTypeFromArrayOrTupleTypeNode`: an array or a tuple type that is first made here is made from a type node
            // (`ObjectFlagsFromTypeNode`).
            TypeNodeKind::Array(element) => {
                let is_deferred = self.is_deferred_type_reference_node(file, scope, node, false);
                let element = if is_deferred {
                    self.deferred_type_argument(file, element)
                } else {
                    self.type_from_node(file, element)
                };
                let made_before = self.p.types.len();
                let ty = self.array_of(element);
                self.p.types.mark_manifest(ty, made_before);
                if is_deferred && self.has_type_variables(ty) {
                    self.p.deferred_references.insert(ty, ());
                }
                ty
            }
            TypeNodeKind::Readonly(operand) => {
                let inner = self.type_from_node(file, operand);
                // `getArrayOrTupleTargetType`: it says something of an array or a tuple type written after it, of nothing else.
                if operand.is_none()
                    || !matches!(
                        hir[operand].kind,
                        TypeNodeKind::Array(_) | TypeNodeKind::Tuple(_)
                    )
                {
                    return inner;
                }
                // `isReadonlyTypeOperator(node.Parent)`: not through parentheses or the `!` of a JSDoc type, of which no node is kept.
                if !hir.text.is_empty()
                    && self.skip_trivia_from(file, hir[node].pos + b"readonly".len() as u32)
                        != hir[operand].pos
                {
                    return inner;
                }
                let made_before = self.p.types.len();
                let ty = match self.data(inner) {
                    TypeData::Tuple { elems, flags, .. } => self.tuple(elems, flags, true),
                    _ => match self.array_element(inner) {
                        Some(element) => self.readonly_array_of(element),
                        None => inner,
                    },
                };
                self.p.types.mark_manifest(ty, made_before);
                if self.p.deferred_references.get(&inner).is_some() {
                    self.p.deferred_references.insert(ty, ());
                }
                // `getAliasSymbolForTypeNode` goes out through a `readonly` operator.
                match self.stored_alias(inner) {
                    Some((alias, type_arguments)) if ty != inner => {
                        let made_before = self.p.types.len();
                        let aliased = self.with_alias(ty, *alias, type_arguments);
                        self.p.types.mark_manifest(aliased, made_before);
                        aliased
                    }
                    _ => ty,
                }
            }
            TypeNodeKind::Tuple(elems) => {
                let mut types = Vec::with_capacity(elems.len());
                let mut flags = Vec::with_capacity(elems.len());
                // A tuple type with a variadic element is never deferred.
                let is_deferred = !elems
                    .iter()
                    .any(|e| is_variadic_tuple_element(hir, &hir[e]))
                    && self.is_deferred_type_reference_node(file, scope, node, false);
                for e in elems.iter() {
                    let elem = &hir[e];
                    // `getTypeFromRestTypeNode`: of `...X[]` it is `X` that is resolved.
                    if is_deferred
                        && elem.rest
                        && let Some(element) = array_element_type_node(hir, elem.ty)
                        && let Some(waiting) = self.indexed_access_of_alias_under_way(file, element)
                    {
                        types.push(waiting);
                        flags.push(ElemFlags::REST);
                        continue;
                    }
                    let ty = if is_deferred {
                        self.deferred_type_argument(file, elem.ty)
                    } else {
                        self.type_from_node(file, elem.ty)
                    };
                    if elem.rest {
                        match self.array_element(ty) {
                            Some(element) => {
                                types.push(element);
                                flags.push(ElemFlags::REST);
                            }
                            None => {
                                types.push(ty);
                                flags.push(ElemFlags::VARIADIC);
                            }
                        }
                    } else {
                        // `getTypeFromOptionalTypeNode`, `getTypeFromNamedTupleTypeNode`: what may be left out reads as `undefined`
                        // when it is, as a property does.
                        types.push(if elem.optional {
                            self.optional_property(ty)
                        } else {
                            ty
                        });
                        flags.push(if elem.optional {
                            ElemFlags::OPTIONAL
                        } else {
                            ElemFlags::REQUIRED
                        });
                    }
                }
                // `getTupleElementInfo`
                for (flag, e) in flags.iter_mut().zip(elems.iter()) {
                    *flag = flag.with_label(hir[e].name);
                }
                let made_before = self.p.types.len();
                let ty = self.normalized_tuple(&types, &flags, false);
                self.p.types.mark_manifest(ty, made_before);
                ty
            }
            TypeNodeKind::Union(members) => {
                let members = self.types_from_nodes(file, members);
                self.union(&members)
            }
            TypeNodeKind::Intersection(nodes) => {
                let members = self.types_from_nodes(file, nodes);
                // `getTypeFromIntersectionTypeNode`: `string & {}`, written so, stays as it is: `"a" | "b" | (string & {})` is to keep
                // its literals. The same of `number`, `bigint` and a template with nothing generic in it.
                if let [a, b] = members[..]
                    && let Some(empty) = hir.ids(nodes).position(
                        |n| matches!(hir[n].kind, TypeNodeKind::Object(m) if m.is_empty()),
                    )
                {
                    let other = members[1 - empty];
                    if matches!(other, TypeId::STRING | TypeId::NUMBER | TypeId::BIGINT)
                        || matches!(self.data(other), TypeData::Template { .. })
                            && self.is_pattern_literal(other)
                    {
                        let ty = self.intern(TypeData::Intersection(Box::new([a, b])));
                        return match self.alias_for_type_node(file, scope, node) {
                            Some((alias, type_arguments)) => {
                                self.with_alias(ty, alias, &type_arguments)
                            }
                            None => ty,
                        };
                    }
                }
                let alias = self.alias_for_type_node(file, scope, node);
                let alias = alias
                    .as_ref()
                    .map(|(alias, type_arguments)| (*alias, &type_arguments[..]));
                self.intersection_with_alias(&members, alias)
            }
            TypeNodeKind::Fn(func) => {
                let mapper = self.identity_mapper_for_node(file, scope, node);
                self.intern(TypeData::Fns {
                    decls: Box::new([(file, func)]),
                    mapper,
                })
            }
            TypeNodeKind::Object(members) => {
                // `emptyTypeLiteralType`, unless it is the body of an alias.
                if members.is_empty() {
                    return match self.alias_for_type_node(file, scope, node) {
                        Some((alias, type_arguments)) => {
                            self.with_alias(TypeId::EMPTY_OBJECT, alias, &type_arguments)
                        }
                        None => TypeId::EMPTY_OBJECT,
                    };
                }
                let mapper = self.identity_mapper_for_node(file, scope, node);
                self.intern(TypeData::Anon {
                    origin: Origin::TypeLiteral(file, node),
                    mapper,
                })
            }
            TypeNodeKind::Mapped(m) => {
                // `getTypeFromMappedTypeNode`: the constraint of the key is resolved at once, through its base constraint
                // (`hasNonCircularBaseConstraint`), which detects a cycle through a type alias.
                let key = self.type_param(file, hir[m].param);
                self.base_constraint(key);
                let mapper = self.identity_mapper_for_node(file, scope, node);
                self.instantiate_mapped(file, node, mapper)
            }
            TypeNodeKind::Cond { .. } => {
                let mapper = self.identity_mapper_for_node(file, scope, node);
                self.conditional_type(file, node, mapper)
            }
            TypeNodeKind::Infer(param) => self.declared_type_of_type_parameter(file, param),
            TypeNodeKind::IndexedAccess { obj, index } => {
                let (obj, index) = (
                    self.type_from_node(file, obj),
                    self.type_from_node(file, index),
                );
                // `getIndexedAccessTypeEx`: with an access node, what `getIndexedAccessTypeOrUndefined` does not find is the error type.
                // Without one, in an instantiation, it is `unknown`.
                if self.is_known(obj)
                    && self.is_known(index)
                    && index != TypeId::NEVER
                    && !self.is_generic(obj)
                    && !self.is_generic(index)
                    && self.parts(index).iter().any(|&key| {
                        self.indexed_access_if_any(obj, key, false).is_none()
                            && !self.property_name_of_type(key).is_some_and(|name| {
                                let apparent = self.apparent_type(obj);
                                self.type_of_property(apparent, name).is_some()
                            })
                    })
                {
                    return TypeId::ERROR;
                }
                let ty = self.indexed_access(obj, index);
                // `getPropertyTypeForIndexType`: written as `T["p"]`, what may be missing reads as `undefined`.
                if self.contains_missing_type(ty) {
                    self.union(&[ty, TypeId::UNDEFINED])
                } else {
                    ty
                }
            }
            TypeNodeKind::Keyof(inner) => {
                let inner = self.type_from_node(file, inner);
                self.keyof(inner)
            }
            TypeNodeKind::Template { types, texts } => {
                let types = self.types_from_nodes(file, types);
                let texts: Vec<Atom> = hir.ids(texts).collect();
                self.template_type(&texts, &types)
            }
            TypeNodeKind::Predicate { asserts, .. } => {
                if asserts {
                    TypeId::VOID
                } else {
                    TypeId::BOOLEAN
                }
            }
            TypeNodeKind::Typeof { name, args, expr } => {
                let narrowed = self.type_of_expr(file, expr);
                // `getTypeFromTypeQueryNode`, `getWidenedType`: the value `undefined` says nothing without strictNullChecks. What is
                // declared `undefined` stays so.
                if !self.p.files.options.strict_null_checks && narrowed == TypeId::UNDEFINED {
                    let is_global = |e: ExprId| self.bound(file).expr_symbol[e.idx()].is_none();
                    let is_the_value = match hir[expr].kind {
                        ExprKind::Ident(known::undefined) => is_global(expr),
                        ExprKind::Dot {
                            obj,
                            name: known::undefined,
                            ..
                        } => {
                            matches!(hir[obj].kind, ExprKind::Ident(known::globalThis))
                                && is_global(obj)
                        }
                        _ => false,
                    };
                    if is_the_value {
                        return TypeId::ANY;
                    }
                }
                // `checkPropertyAccessExpressionOrQualifiedName`: the missing name of `typeof a.` finds no property: the error type.
                if narrowed == TypeId::UNRESOLVED && hir.ids(name).next_back() == Some(known::empty)
                {
                    return TypeId::ERROR;
                }
                let ty = if narrowed == TypeId::UNRESOLVED {
                    let names: SmallVec<[Atom; 4]> = hir.ids(name).collect();
                    self.type_of_entity(file, scope, &names)
                } else {
                    self.regular(narrowed)
                };
                if args.is_empty() {
                    return ty;
                }
                let args = self.types_from_nodes(file, args);
                self.with_type_arguments(ty, &args, InstantiationExpression::TypeNode(file, node))
            }
            TypeNodeKind::Import {
                spec,
                name,
                args,
                is_typeof,
                mode,
            } => {
                // `getTypeFromImportTypeNode`
                let mode = self.files().mode_of_import(file, mode);
                let Some(module) = self.files().module_of_specifier_as(file, spec, mode) else {
                    return TypeId::ERROR;
                };
                let names: SmallVec<[Atom; 4]> = hir.ids(name).collect();
                // `resolveExternalModuleSymbol`: the module, or what it says it is with `export =`. One that could not be followed is
                // `unknownSymbol`.
                let value = self.files().module_value(module);
                let is_followed = self
                    .files()
                    .flags(value)
                    .intersects(SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE);
                if is_typeof {
                    // The module is no value.
                    if names.is_empty()
                        && is_followed
                        && !self.files().symbol_flags(value).intersects(SymFlags::VALUE)
                    {
                        return TypeId::ERROR;
                    }
                    // Name by name a property of the type of the value before. Those of a module or a namespace are what it
                    // exports, what it exports as a type only too.
                    let mut at: Result<Sym, TypeId> = Ok(value);
                    for &n in &names {
                        if let Ok(container) = at
                            && let Some(member) = self.files().namespace_member(container, n)
                        {
                            match self.files().resolve_alias_as(member, SymFlags::VALUE) {
                                Some(next)
                                    if self.files().flags(next).intersects(SymFlags::VALUE) =>
                                {
                                    at = Ok(next);
                                    continue;
                                }
                                Some(_) => {}
                                None => {
                                    at = Err(self.type_of_symbol(member));
                                    continue;
                                }
                            }
                        }
                        let ty = match at {
                            Ok(sym) => self.type_of_symbol(sym),
                            Err(ty) => ty,
                        };
                        // `getPropertyOfTypeEx`: `any` has no properties.
                        let property = if self.has_any_flag(ty) {
                            None
                        } else {
                            self.type_of_property(ty, n)
                        };
                        match property {
                            Some(next) => at = Err(next),
                            None => {
                                return if self.is_known(ty) {
                                    TypeId::ERROR
                                } else {
                                    TypeId::UNRESOLVED
                                };
                            }
                        }
                    }
                    let ty = match at {
                        Ok(sym) => self.type_of_symbol(sym),
                        Err(ty) => ty,
                    };
                    if args.is_empty() {
                        return ty;
                    }
                    let args = self.types_from_nodes(file, args);
                    let node = InstantiationExpression::TypeNode(file, node);
                    return self.with_type_arguments(ty, &args, node);
                }
                if !is_followed {
                    return TypeId::ERROR;
                }
                // Namespaces up to the last name, which is to be a type.
                let mut sym = value;
                for (i, &n) in names.iter().enumerate() {
                    let wanted = if i + 1 == names.len() {
                        SymFlags::TYPE
                    } else {
                        SymFlags::NAMESPACE
                    };
                    let Some(member) = self.files().namespace_member(sym, n) else {
                        return TypeId::ERROR;
                    };
                    let Some(next) = self.files().resolve_alias_as(member, wanted) else {
                        return TypeId::ERROR;
                    };
                    if !self.files().flags(next).intersects(wanted) {
                        return TypeId::ERROR;
                    }
                    sym = next;
                }
                // `getDeclaredTypeOfAlias`: `resolveSymbol` does not follow an `export =` that is a namespace as well as an alias.
                if self.files().flags(sym).contains(SymFlags::ALIAS)
                    && !self.type_flags_of_symbol(sym).intersects(SymFlags::TYPE)
                {
                    let Some(target) = self.files().resolve_alias(sym) else {
                        return TypeId::ERROR;
                    };
                    // `checkNoTypeArguments`
                    if !args.is_empty()
                        || !self.type_flags_of_symbol(target).intersects(SymFlags::TYPE)
                    {
                        return TypeId::ERROR;
                    }
                    let ty = self.declared_type(target);
                    return self.regular(ty);
                }
                // `getTypeReferenceType`
                let flags = self.type_flags_of_symbol(sym);
                if !flags.intersects(SymFlags::TYPE) {
                    return TypeId::ERROR;
                }
                let (least, most) = self.type_argument_arity(sym);
                // `getTypeFromClassOrInterfaceReference`: `isJs`, as for a type reference.
                let is_js_reference = hir.is_js
                    && flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE)
                    && most != 0;
                if !is_js_reference && (args.len() < least || args.len() > most) {
                    return TypeId::ERROR;
                }
                let mut args = self.types_from_nodes(file, args);
                if is_js_reference {
                    let params = self.local_type_params_of_symbol(sym);
                    args = self.fill_type_args_as(&params, &args, true);
                }
                self.written_type_reference(sym, &args)
            }
            TypeNodeKind::Ref { name, args } => {
                if let Some(intended) = self.intended_type_of_jsdoc_reference(file, node) {
                    return intended;
                }
                let names: SmallVec<[Atom; 4]> = hir.ids(name).collect();
                // `resolveTypeReferenceName`: `getUnresolvedSymbolForEntityName`
                let Some(found) = self
                    .files()
                    .resolve_entity(file, scope, &names, SymFlags::TYPE)
                else {
                    let args = self.types_from_nodes(file, args);
                    return self.unresolved_name_type(&names, &args);
                };
                // `getIntendedTypeFromJSDocTypeReference`
                if self.is_jsdoc_object_with_arguments(file, node) {
                    let key = self.type_from_node(file, hir.id_at(args, 0));
                    if !self.is_valid_index_key_type(key) {
                        return TypeId::ANY;
                    }
                }
                // `resolveEntityName`: an alias is followed as far as the first symbol that is a type.
                let target = self.files().resolve_alias_as(found, SymFlags::TYPE);
                let sym = match target {
                    Some(sym) => sym,
                    // `getSymbol`: an import that resolves to a property of an `export =` value has no type meaning, so `Resolve`
                    // continues in the enclosing scopes.
                    None if names.len() == 1
                        && self.imported_property_of_export_equals(found).is_some() =>
                    {
                        let Some(outer) =
                            self.resolve_type_name_beyond(file, scope, names[0], found)
                        else {
                            let args = self.types_from_nodes(file, args);
                            return self.unresolved_name_type(&names, &args);
                        };
                        let Some(sym) = self.files().resolve_alias_as(outer, SymFlags::TYPE) else {
                            let args = self.types_from_nodes(file, args);
                            return self.unresolved_name_type(&names, &args);
                        };
                        sym
                    }
                    None => {
                        let args = self.types_from_nodes(file, args);
                        return self.unresolved_name_type(&names, &args);
                    }
                };
                // `getSymbol`: what is no type is not found where one is looked for.
                let flags = self.type_flags_of_symbol(sym);
                if !flags.intersects(SymFlags::TYPE) {
                    let args = self.types_from_nodes(file, args);
                    return self.unresolved_name_type(&names, &args);
                }
                let is_class_or_interface = flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE);
                let (least, most) = self.type_argument_arity(sym);
                // `getTypeFromClassOrInterfaceReference`: in a JavaScript file a generic class or interface takes any number of type
                // arguments. Everywhere else the wrong number gives the error type.
                let is_js_reference = hir.is_js && is_class_or_interface && most != 0;
                if !is_js_reference && (args.len() < least || args.len() > most) {
                    return TypeId::ERROR;
                }
                let is_deferred = is_class_or_interface
                    && most != 0
                    && self.is_deferred_type_reference_node(file, scope, node, args.len() != most);
                let mut args = if is_deferred {
                    hir.ids(args)
                        .map(|arg| self.deferred_type_argument(file, arg))
                        .collect::<Vec<_>>()
                } else {
                    self.types_from_nodes(file, args)
                };
                if is_js_reference {
                    let params = self.local_type_params_of_symbol(sym);
                    args = self.fill_type_args_as(&params, &args, true);
                }
                // `getTypeFromTypeAliasReference`: a reference to a generic alias that is the body of another alias is instantiated
                // under that alias, which is part of the cache key (`getConditionalTypeKey`).
                if self.reports_depth
                    && most != 0
                    && !is_class_or_interface
                    && flags.contains(SymFlags::TYPE_ALIAS)
                    && !self.stack.contains(&Query::Declared(sym))
                    && let Some(host) = self.alias_with_body(file, scope, node)
                {
                    let host = self
                        .files()
                        .sym(file, self.bound(file).alias_symbol[host.idx()]);
                    let declared = self.declared_type_by_name(sym, flags);
                    self.aliased_reference = matches!(self.data(declared), TypeData::Cond { .. })
                        && (self.is_local_type_alias(sym) || !self.is_local_type_alias(host));
                }
                let mut ty = self.written_type_reference(sym, &args);
                self.aliased_reference = false;
                if most != 0
                    && !is_class_or_interface
                    && flags.contains(SymFlags::TYPE_ALIAS)
                    // `getIntendedTypeFromJSDocTypeReference` instantiates `Record` for `Object<K, V>` under no alias.
                    && !self.is_jsdoc_object_with_arguments(file, node)
                    && let Some(host) = self.alias_with_body(file, scope, node)
                {
                    ty = self.with_hosting_alias(ty, (sym, flags), file, host);
                    if let Some((alias, type_arguments)) =
                        self.alias_for_type_node(file, scope, node)
                        && (self.is_local_type_alias(sym) || !self.is_local_type_alias(alias))
                    {
                        ty = self.instantiated_under_alias(sym, &args, ty, alias, &type_arguments);
                    }
                }
                if is_deferred && self.has_type_variables(ty) {
                    self.p.deferred_references.insert(ty, ());
                }
                // `createDeferredTypeReference`
                if is_deferred
                    && matches!(self.data(ty), TypeData::Ref { .. } | TypeData::Tuple { .. })
                    && let Some((alias, type_arguments)) =
                        self.alias_for_type_node(file, scope, node)
                {
                    let made_before = self.p.types.len();
                    ty = self.with_alias(ty, alias, &type_arguments);
                    self.p.types.mark_manifest(ty, made_before);
                }
                // `combineValueAndTypeSymbols`: an interface imported by name from an `export =` module whose value has a property of
                // that name is a new symbol with a new declared type. `this` in its own members is still the `this` type of the
                // original interface (`getThisType`), which the new type never binds.
                if target.is_some()
                    && found != sym
                    && flags.contains(SymFlags::INTERFACE)
                    && !self.files().flags(sym).intersects(SymFlags::VALUE)
                    && self.interface_members_mention_this(sym)
                    && self.imported_property_of_export_equals(found).is_some()
                {
                    let this = self.intern(TypeData::ThisParam(sym));
                    return self.type_with_this_argument(ty, this);
                }
                ty
            }
        }
    }

    /// `Resolve`, continued past the scope that declares `skipped`: the symbol found for `name` from `scope` has no type meaning.
    pub(super) fn resolve_type_name_beyond(
        &self,
        file: FileId,
        mut scope: ScopeId,
        name: Atom,
        skipped: Sym,
    ) -> Option<Sym> {
        let bound = self.bound(file);
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            scope = s.parent;
            if bound
                .lookup(s.locals, name)
                .is_some_and(|id| self.files().sym(file, id) == skipped)
            {
                break;
            }
        }
        self.files()
            .resolve_name(file, scope, name, SymFlags::TYPE)
            .filter(|&outer| outer != skipped)
    }

    /// `getIntendedTypeFromJSDocTypeReference`, of what the parser has not replaced already. The name is not looked up then.
    pub(super) fn intended_type_of_jsdoc_reference(
        &mut self,
        file: FileId,
        node: TypeNodeId,
    ) -> Option<TypeId> {
        if let Some(primitive) = self.jsdoc_primitive_with_type_arguments(file, node) {
            return Some(primitive);
        }
        if self.p.files.options.no_implicit_any {
            return None;
        }
        let hir = self.hir(file);
        let TypeNodeKind::Ref { name, args } = hir[node].kind else {
            return None;
        };
        if name.len() != 1 || !hir.is_in_jsdoc(hir[node].pos) {
            return None;
        }
        match self.files().atoms.bytes(hir.id_at(name, 0)) {
            b"Object" => Some(TypeId::ANY),
            b"array" if args.is_empty() => Some(self.array_of(TypeId::ANY)),
            b"promise" if args.is_empty() => Some(self.promise_of(TypeId::ANY)),
            _ => None,
        }
    }

    /// The first type alias declaration of `sym`.
    fn alias_declaration(&self, sym: Sym) -> Option<(FileId, AliasId)> {
        declarations_of(self.files(), sym).find_map(|(file, decl)| match decl {
            Decl::Alias(alias) => Some((file, alias)),
            _ => None,
        })
    }

    /// Whether `node` is written `Object<K, V>` in a JSDoc comment. The parser makes `Record<K, V>` of it.
    pub(super) fn is_jsdoc_object_with_arguments(&self, file: FileId, node: TypeNodeId) -> bool {
        let hir = self.hir(file);
        let pos = hir[node].pos;
        matches!(hir[node].kind, TypeNodeKind::Ref { name, args }
            if args.len() == 2 && name.len() == 1 && hir.id_at(name, 0) == known::Record)
            && hir.is_in_jsdoc(pos)
            && hir
                .text
                .get(pos as usize..)
                .is_some_and(|text| text.starts_with(b"Object"))
    }

    /// `getTypeFromTypeAliasReference`: `ty` is what a reference to the generic alias `hosted` comes to, and the reference is the
    /// whole body of the alias `host` of `file`. tsgo instantiates `hosted` under `host`, which is `Type.alias` of the result and
    /// part of its identity (`getTypeInstantiationKey`). Types do not store an alias. The type parameters of `host` are added
    /// to the mapper of `ty` instead: instantiation keeps them up to date, and `hosting_alias_of` reads them back. For a `host`
    /// without type parameters a reference to it (`LazyAlias`) is added, mapped to itself.
    /// `hosted`: the symbol and its `type_flags_of_symbol`.
    /// Limit: only a mapped type gets one. A type literal, a function type and a conditional type go by `alias_of`.
    fn with_hosting_alias(
        &mut self,
        ty: TypeId,
        hosted: (Sym, SymFlags),
        file: FileId,
        host: AliasId,
    ) -> TypeId {
        let type_params = self.hir(file)[host].type_params;
        let host_symbol = self.bound(file).alias_symbol[host.idx()];
        let Some((of, node, _)) = self.mapped_origin(ty) else {
            return ty;
        };
        if host_symbol.is_none()
            // `instantiateMappedType`: an instantiation of a homomorphic mapped type keeps the alias of the mapped type.
            || self.homomorphic_type_variable(of, node, MapperId::IDENTITY).is_some()
        {
            return ty;
        }
        // `instantiateTypeWithAlias`: the alias goes to an instantiation of the declared type, not to a type argument it comes to.
        let declared = self.declared_type_by_name(hosted.0, hosted.1);
        if self
            .mapped_origin(declared)
            .is_none_or(|(f, n, _)| (f, n) != (of, node))
        {
            return ty;
        }
        // An alias declared in a function does not host a reference to a top-level alias.
        let host_symbol = self.files().sym(file, host_symbol);
        if !self.is_local_type_alias(hosted.0) && self.is_local_type_alias(host_symbol) {
            return ty;
        }
        // `hosted` may host a reference itself: the outermost alias is the one that counts.
        let Some((_, _, mapper)) = self.mapped_origin(self.without_hosting_alias(ty)) else {
            return ty;
        };
        let mut pairs = self.p.types.mapping(mapper).to_vec();
        for tp in type_params.iter() {
            let param = self.type_param(file, tp);
            pairs.push((param, param));
        }
        if type_params.is_empty() {
            let reference = self.intern(TypeData::LazyAlias {
                sym: host_symbol,
                args: Box::new([]),
            });
            pairs.push((reference, reference));
        }
        let mapper = self.p.types.mapper(pairs);
        self.intern(TypeData::Anon {
            origin: Origin::Mapped(of, node),
            mapper,
        })
    }

    /// `isLocalTypeAlias`: whether the type alias `sym` is declared inside a function.
    fn is_local_type_alias(&self, sym: Sym) -> bool {
        let Some((file, alias)) = self.alias_declaration(sym) else {
            return false;
        };
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut scope = bound.alias_scope[alias.idx()];
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            if let ScopeKind::Fn(f) = s.kind
                && hir[f].kind != FnKind::StaticBlock
            {
                return true;
            }
            scope = s.parent;
        }
        false
    }

    /// Whether a member declared by the interface `sym` itself mentions `this` (`NodeFlagsContainsThis`, as `isThislessInterface`
    /// reads it).
    fn interface_members_mention_this(&self, sym: Sym) -> bool {
        let mut mentioned = Mentioned::default();
        for (file, decl) in declarations_of(self.files(), sym) {
            let Decl::Interface(interface) = decl else {
                continue;
            };
            let hir = self.hir(file);
            for m in hir[interface].members.iter() {
                self.collect_mentions(file, hir[m].ty, &mut mentioned);
                if hir[m].func.is_some() {
                    self.collect_fn_mentions(file, hir[m].func, &mut mentioned);
                }
            }
        }
        mentioned.this || mentioned.everything
    }

    /// `getThisType`: `this` as a type, written at `node` in `scope`. Where there is no such thing it is in error, and what is in
    /// error has the error type.
    fn this_type_at(&mut self, file: FileId, node: TypeNodeId, mut scope: ScopeId) -> TypeId {
        use crate::bind::{FnOwner, MemberOwner};
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `GetThisContainer`: a member of a type literal is as far as it gets.
        if bound.this_in_type_literal.contains(&node) {
            return TypeId::ERROR;
        }
        let pos = hir[node].pos;
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            match s.kind {
                ScopeKind::Fn(f) => match hir[f].kind {
                    FnKind::Arrow | FnKind::FunctionType | FnKind::ConstructorType => {}
                    FnKind::Decl | FnKind::Expr | FnKind::StaticBlock => return TypeId::ERROR,
                    kind => {
                        // A method or an accessor of an object literal is no member.
                        let FnOwner::Member(m) = bound.fns[f.idx()].owner else {
                            return TypeId::ERROR;
                        };
                        // Of a constructor only the body will do. Parameters and body share the one scope.
                        let is_in_body = matches!(hir[f].body, FnBody::Block(body) if hir.ids(body).next().is_some_and(|first| hir[first].pos <= pos));
                        if hir[m].flags.contains(Flags::STATIC)
                            || !matches!(
                                bound.member_owner[m.idx()],
                                MemberOwner::Class(_) | MemberOwner::Interface(_)
                            )
                            || kind == FnKind::Constructor && !is_in_body
                        {
                            return TypeId::ERROR;
                        }
                        return self.this_type_in_scope(file, s.parent);
                    }
                },
                // Not in a method: in a property, or else in the head of the class or the name of a method, which are outside.
                ScopeKind::Class(c) => {
                    if let Some(m) = hir[c].members.iter().rev().find(|&m| hir[m].pos <= pos)
                        && hir[m].kind == MemberKind::Property
                    {
                        return if hir[m].flags.contains(Flags::STATIC) {
                            TypeId::ERROR
                        } else {
                            self.this_type_in_scope(file, scope)
                        };
                    }
                }
                ScopeKind::Interface(i) => {
                    if hir[i].members.iter().any(|m| hir[m].pos <= pos) {
                        return self.this_type_in_scope(file, scope);
                    }
                }
                ScopeKind::Module(_) | ScopeKind::Enum(_) | ScopeKind::File => {
                    return TypeId::ERROR;
                }
                _ => {}
            }
            scope = s.parent;
        }
        TypeId::ERROR
    }

    /// The `this` type of the class or the interface around `scope`.
    pub fn this_type_in_scope(&mut self, file: FileId, mut scope: ScopeId) -> TypeId {
        let bound = self.bound(file);
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            match s.kind {
                ScopeKind::Class(c) => {
                    let sym = self.files().sym(file, bound.class_symbol[c.idx()]);
                    return self.intern(TypeData::ThisParam(sym));
                }
                ScopeKind::Interface(i) => {
                    let sym = self.files().sym(file, bound.interface_symbol[i.idx()]);
                    return self.intern(TypeData::ThisParam(sym));
                }
                _ => scope = s.parent,
            }
        }
        TypeId::UNRESOLVED
    }

    /// `type_reference`, for a reference that is written out.
    fn written_type_reference(&mut self, sym: Sym, args: &[TypeId]) -> TypeId {
        if !self
            .type_flags_of_symbol(sym)
            .intersects(SymFlags::CLASS | SymFlags::INTERFACE)
        {
            return self.type_reference(sym, args);
        }
        // `getTypeFromClassOrInterfaceReference`: a reference to a class or an interface that is first made here is made from a type
        // node (`ObjectFlagsFromTypeNode`). The declared type is not made here, and what an alias comes to is made by instantiation.
        self.declared_type(sym);
        let made_before = self.p.types.len();
        let ty = self.type_reference(sym, args);
        self.p.types.mark_manifest(ty, made_before);
        ty
    }

    /// `isDeferredTypeReferenceNode`, as far as what is written at `node` goes: an array type, a tuple type without a `...T`, or a
    /// reference to a generic class or interface may leave its type arguments for when somebody wants them. Nothing else does.
    fn may_put_off_type_arguments(&self, file: FileId, node: TypeNodeId) -> bool {
        let hir = self.hir(file);
        match hir[node].kind {
            TypeNodeKind::Array(_) => true,
            TypeNodeKind::Tuple(elems) => !elems
                .iter()
                .any(|e| is_variadic_tuple_element(hir, &hir[e])),
            TypeNodeKind::Ref { name, .. } => {
                let names: SmallVec<[Atom; 4]> = hir.ids(name).collect();
                let scope = self.bound(file).type_scope[node.idx()];
                let found = self
                    .files()
                    .resolve_entity(file, scope, &names, SymFlags::TYPE);
                found
                    .and_then(|found| self.files().resolve_alias_as(found, SymFlags::TYPE))
                    .is_some_and(|sym| {
                        self.type_flags_of_symbol(sym)
                            .intersects(SymFlags::CLASS | SymFlags::INTERFACE)
                            && self.type_argument_arity(sym).1 != 0
                    })
            }
            _ => false,
        }
    }

    /// `isDeferredTypeReferenceNode`, for `node` written in `scope`: an array type, a tuple type or a reference to a generic class
    /// or interface.
    fn is_deferred_type_reference_node(
        &self,
        file: FileId,
        scope: ScopeId,
        node: TypeNodeId,
        has_default_type_arguments: bool,
    ) -> bool {
        // `isResolvedByTypeAlias`, which also holds for the body of an alias.
        if !self.bound(file).type_by_alias[node.idx()] {
            return false;
        }
        if self.alias_with_body(file, scope, node).is_some() {
            return true;
        }
        let hir = self.hir(file);
        match hir[node].kind {
            TypeNodeKind::Array(element) => self.may_resolve_type_alias(file, element),
            TypeNodeKind::Tuple(elems) => elems.iter().any(|e| {
                let elem = &hir[e];
                // A rest element without a name is a `RestType` node.
                if elem.rest && elem.name.is_none() && elem.ty.is_some() {
                    return match hir[elem.ty].kind {
                        TypeNodeKind::Array(element) => self.may_resolve_type_alias(file, element),
                        _ => true,
                    };
                }
                self.may_resolve_type_alias(file, elem.ty)
            }),
            TypeNodeKind::Ref { args, .. } => {
                has_default_type_arguments
                    || hir
                        .ids(args)
                        .any(|arg| self.may_resolve_type_alias(file, arg))
            }
            _ => false,
        }
    }

    /// `mayResolveTypeAlias`: whether resolving `node` can resolve a type alias.
    fn may_resolve_type_alias(&self, file: FileId, node: TypeNodeId) -> bool {
        if node.is_none() {
            return false;
        }
        let hir = self.hir(file);
        match hir[node].kind {
            TypeNodeKind::Ref { name, .. } => {
                let names: SmallVec<[Atom; 4]> = hir.ids(name).collect();
                let scope = self.bound(file).type_scope[node.idx()];
                let found = self
                    .files()
                    .resolve_entity(file, scope, &names, SymFlags::TYPE);
                found
                    .and_then(|found| self.files().resolve_alias_as(found, SymFlags::TYPE))
                    .is_some_and(|sym| {
                        self.type_flags_of_symbol(sym)
                            .contains(SymFlags::TYPE_ALIAS)
                    })
            }
            TypeNodeKind::Typeof { .. } => true,
            TypeNodeKind::Keyof(operand) | TypeNodeKind::Readonly(operand) => {
                self.may_resolve_type_alias(file, operand)
            }
            TypeNodeKind::Union(types) | TypeNodeKind::Intersection(types) => {
                hir.ids(types).any(|t| self.may_resolve_type_alias(file, t))
            }
            TypeNodeKind::IndexedAccess { obj, index } => {
                self.may_resolve_type_alias(file, obj) || self.may_resolve_type_alias(file, index)
            }
            TypeNodeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => [check, extends, yes, no]
                .into_iter()
                .any(|t| self.may_resolve_type_alias(file, t)),
            _ => false,
        }
    }

    /// The type alias whose declaration `scope` is in.
    fn enclosing_alias(&self, file: FileId, mut scope: ScopeId) -> Option<Sym> {
        let bound = self.bound(file);
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            if s.kind == ScopeKind::TypeParams
                && let Some(alias) = bound.alias_scope.iter().position(|&own| own == scope)
            {
                return Some(self.files().sym(file, bound.alias_symbol[alias]));
            }
            scope = s.parent;
        }
        None
    }

    /// `Alias` or `Alias<Args>` written at `node` with a valid number of type arguments: the alias and its type argument nodes.
    /// `None` for an alias declared under outer type parameters: a `LazyAlias` holds only the alias's own type arguments.
    pub(super) fn deferrable_alias_reference(
        &mut self,
        file: FileId,
        node: TypeNodeId,
    ) -> Option<(Sym, IdList<TypeNodeId>)> {
        if node.is_none() {
            return None;
        }
        let hir = self.hir(file);
        let TypeNodeKind::Ref { name, args } = hir[node].kind else {
            return None;
        };
        let names: SmallVec<[Atom; 4]> = hir.ids(name).collect();
        let found = self.files().resolve_entity(
            file,
            self.bound(file).type_scope[node.idx()],
            &names,
            SymFlags::TYPE,
        )?;
        let sym = self.files().resolve_alias_as(found, SymFlags::TYPE)?;
        let flags = self.type_flags_of_symbol(sym);
        if !flags.contains(SymFlags::TYPE_ALIAS)
            || flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE)
            || self.is_declared_intrinsic(sym)
        {
            return None;
        }
        let (least, most) = self.type_argument_arity(sym);
        if args.len() < least || args.len() > most {
            return None;
        }
        let (declared_in, alias) = self.alias_declaration(sym)?;
        let bound = self.bound(declared_in);
        let own = bound.alias_scope[alias.idx()];
        if own.is_none()
            || !self
                .type_params_in_scope(declared_in, bound.scopes[own.idx()].parent)
                .is_empty()
        {
            return None;
        }
        Some((sym, args))
    }

    /// `Alias<Args>[K]` written at `node`, in a type argument that a deferred type reference node puts off, where the generic `Alias` is
    /// not resolved yet. tsgo resolves the node on the first `getTypeArguments`, when it is. The access waits on a reference to the alias.
    fn indexed_access_of_alias_under_way(
        &mut self,
        file: FileId,
        node: TypeNodeId,
    ) -> Option<TypeId> {
        if node.is_none() {
            return None;
        }
        let TypeNodeKind::IndexedAccess { obj, index } = self.hir(file)[node].kind else {
            return None;
        };
        let (sym, args) = self.deferrable_alias_reference(file, obj)?;
        if args.is_empty() {
            return None;
        }
        let is_under_way = self.stack.contains(&Query::Declared(sym))
            || self.p.declared_types.get(&sym).is_none()
                && self.enclosing_alias(file, self.bound(file).type_scope[node.idx()]) == Some(sym);
        if !is_under_way {
            return None;
        }
        let args = self.types_from_nodes(file, args);
        let params = self.local_type_params_of_symbol(sym);
        let args = self.fill_type_args(&params, &args);
        let obj = self.intern(TypeData::LazyAlias {
            sym,
            args: args.into(),
        });
        if !self.has_type_variables(obj) {
            return None;
        }
        let index = self.type_from_node(file, index);
        Some(self.intern(TypeData::IndexedAccess {
            obj,
            index,
            undefined: false,
        }))
    }

    /// The type of an element or type argument of a deferred type reference node (`isDeferredTypeReferenceNode`). tsgo resolves it
    /// on the first `getTypeArguments`. There are no deferred references here: the node is resolved now, and a direct reference to
    /// an alias stays a `LazyAlias` where resolving it leads back to the reference.
    fn deferred_type_argument(&mut self, file: FileId, node: TypeNodeId) -> TypeId {
        // tsgo has not asked for the argument yet, so a cycle through it is not an error.
        self.eager.push(self.stack.len());
        let ty = self.deferred_type_argument_worker(file, node);
        self.eager.pop();
        ty
    }

    /// `deferred_type_argument`, inside its `eager` marker.
    fn deferred_type_argument_worker(&mut self, file: FileId, node: TypeNodeId) -> TypeId {
        let Some((sym, args)) = self.deferrable_alias_reference(file, node) else {
            return match self.indexed_access_of_alias_under_way(file, node) {
                Some(waiting) => waiting,
                None => self.type_from_node(file, node),
            };
        };
        // Instantiating the deferred reference must not instantiate the alias again, so a generic alias referenced in its own
        // declaration is never expanded here.
        let is_self_reference = !args.is_empty()
            && self.enclosing_alias(file, self.bound(file).type_scope[node.idx()]) == Some(sym);
        if !is_self_reference {
            let cycles = self.cycles;
            let ty = self.type_from_node(file, node);
            if self.cycles == cycles || self.is_known(ty) {
                return ty;
            }
        }
        let args = self.types_from_nodes(file, args);
        let params = self.local_type_params_of_symbol(sym);
        let args = self.fill_type_args(&params, &args);
        self.intern(TypeData::LazyAlias {
            sym,
            args: args.into(),
        })
    }

    /// The conditional type `ty` as an unresolved reference to the generic type alias whose whole body it instantiates. `None` for any
    /// other type, and for an alias declared under outer type parameters (see `deferrable_alias_reference`).
    pub(super) fn as_unresolved_alias_reference(&mut self, ty: TypeId) -> Option<TypeId> {
        let TypeData::Cond { file, node, mapper } = *self.data(ty) else {
            return None;
        };
        let bound = self.bound(file);
        let scope = bound.type_scope[node.idx()];
        if scope.is_none() {
            return None;
        }
        let alias = self.alias_with_body(file, scope, node)?;
        if !self
            .type_params_in_scope(file, bound.scopes[scope.idx()].parent)
            .is_empty()
        {
            return None;
        }
        let sym = self.files().sym(file, bound.alias_symbol[alias.idx()]);
        let params = self.local_type_params_of_symbol(sym);
        if params.is_empty() {
            return None;
        }
        let args: Box<[TypeId]> = params
            .iter()
            .map(|&param| self.p.types.map(mapper, param).unwrap_or(param))
            .collect();
        Some(self.intern(TypeData::LazyAlias { sym, args }))
    }

    /// `sym<args>`, where `sym` is not an alias for something imported.
    pub fn type_reference(&mut self, sym: Sym, args: &[TypeId]) -> TypeId {
        let flags = self.type_flags_of_symbol(sym);
        if flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE) {
            let declared = self.declared_type(sym);
            let params = self.local_type_params_of_symbol(sym);
            if params.is_empty() {
                return declared;
            }
            let filled = self.fill_type_args(&params, args);
            // `getTypeFromClassOrInterfaceReference`: only its own are given. Those around the declaration are passed on as they are.
            let outer: &[TypeId] = match self.data(declared) {
                TypeData::Ref { args: all, .. } => &all[..all.len().saturating_sub(params.len())],
                _ => &[],
            };
            let args: Box<[TypeId]> = if outer.is_empty() {
                filled.into()
            } else {
                outer.iter().copied().chain(filled).collect()
            };
            return self.intern(TypeData::Ref { target: sym, args });
        }
        if flags.contains(SymFlags::TYPE_ALIAS) {
            if let Some(i) = self.stack.iter().rposition(|q| *q == Query::Declared(sym)) {
                // What a heritage clause names puts nothing off.
                let is_put_off = (i + 1..self.stack.len()).any(|j| {
                    matches!(self.stack[j], Query::TypeNode(f, n)
                        if !matches!(self.stack[j - 1], Query::Bases(_)) && self.may_put_off_type_arguments(f, n))
                });
                // Inside its own definition, where it can wait, it stays a name, to be looked up when somebody needs to know. So it
                // does where TypeScript would not have come back to it.
                if is_put_off || !self.mark_circle_from(i) {
                    return self.intern(TypeData::LazyAlias {
                        sym,
                        args: args.into(),
                    });
                }
                // `getDeclaredTypeOfTypeAlias`, `pushTypeResolution`: it depends on itself, which is an error.
                self.mark_tainted_from(i + 1);
                self.cycles += 1;
                return TypeId::ERROR;
            }
            let params = self.local_type_params_of_symbol(sym);
            if params.is_empty() {
                // `getDeclaredTypeOfTypeAlias`: `type BuiltinIteratorReturn = intrinsic`
                if self.is_declared_intrinsic(sym)
                    && self.files().atoms.bytes(self.files().symbol(sym).name)
                        == b"BuiltinIteratorReturn"
                {
                    return if self.files().options.strict_builtin_iterator_return {
                        self.undefined_as_declared()
                    } else {
                        TypeId::ANY
                    };
                }
                return self.declared_type_by_name(sym, flags);
            }
            let args = self.fill_type_args(&params, args);
            if let Some(kind) = self.intrinsic_alias(sym) {
                return match kind {
                    Ok(kind) => self.string_mapping(kind, args[0]),
                    Err(()) => self.no_infer(args[0]),
                };
            }
            let declared = self.declared_type_by_name(sym, flags);
            let mapper = self.mapper_from(&params, &args);
            let ty = self.instantiate(declared, mapper);
            // `instantiateMappedType`: `mapTypeWithAlias`, with the alias of the mapped type under `mapper`.
            if self.is_union(ty) && self.mapped_origin(declared).is_some() {
                return self.with_alias(ty, sym, &args);
            }
            return ty;
        }
        if flags.intersects(SymFlags::TYPE) {
            return self.declared_type_by_name(sym, flags);
        }
        TypeId::UNRESOLVED
    }

    /// Whether the alias `sym` is declared `= intrinsic`.
    fn is_declared_intrinsic(&self, sym: Sym) -> bool {
        let Some(&Decl::Alias(a)) = self.files().symbol(sym).decls.first() else {
            return false;
        };
        let hir = self.hir(sym.file);
        hir[a].ty.is_some()
            && matches!(
                hir[hir[a].ty].kind,
                TypeNodeKind::Keyword(Keyword::Intrinsic)
            )
    }

    /// `intrinsicTypeKinds`: `type Uppercase<S extends string> = intrinsic` and the like. `Err`: `NoInfer`.
    pub(super) fn intrinsic_alias(&self, sym: Sym) -> Option<Result<StringMappingKind, ()>> {
        if !self.is_declared_intrinsic(sym) {
            return None;
        }
        match self.files().symbol(sym).name {
            known::Uppercase => Some(Ok(StringMappingKind::Uppercase)),
            known::Lowercase => Some(Ok(StringMappingKind::Lowercase)),
            known::Capitalize => Some(Ok(StringMappingKind::Capitalize)),
            known::Uncapitalize => Some(Ok(StringMappingKind::Uncapitalize)),
            known::NoInfer => Some(Err(())),
            _ => None,
        }
    }

    /// The type of the value `a.b.c` names in `scope`: `typeof a.b.c`.
    pub fn type_of_entity(&mut self, file: FileId, scope: ScopeId, names: &[Atom]) -> TypeId {
        let Some(&first) = names.first() else {
            return TypeId::UNRESOLVED;
        };
        let mut ty = if first == known::this {
            self.this_type_in_scope(file, scope)
        } else {
            match self
                .files()
                .resolve_name(file, scope, first, SymFlags::VALUE)
            {
                Some(sym) => self.type_of_symbol(sym),
                None => return TypeId::UNRESOLVED,
            }
        };
        for &name in &names[1..] {
            ty = self
                .type_of_property(ty, name)
                .unwrap_or(TypeId::UNRESOLVED);
        }
        ty
    }

    // ───────────────────────────── signatures ─────────────────────────────

    /// `getSignatureFromDeclaration`
    pub fn sig_of_fn(&mut self, file: FileId, func: FnId) -> SigId {
        use crate::bind::{FnOwner, MemberOwner};
        let bound = self.bound(file);
        if self.hir(file)[func].kind == FnKind::Constructor
            && let FnOwner::Member(member) = bound.fns[func.idx()].owner
            && let MemberOwner::Class(class) = bound.member_owner[member.idx()]
        {
            let sym = self.files().sym(file, bound.class_symbol[class.idx()]);
            return self.sig_of_constructor(sym, file, class, func);
        }
        let scope = self.bound(file).fns[func.idx()].scope;
        let parent = if scope.is_some() {
            self.bound(file).scopes[scope.idx()].parent
        } else {
            ScopeId::NONE
        };
        let mapper = self.identity_mapper(file, parent);
        self.p
            .types
            .intern_sig(SigData::Decl { file, func, mapper })
    }

    /// `getSignatureFromDeclaration`, of the constructor `func` in the declaration `class` of `sym`: its type parameters are those
    /// of the class, and it returns the class.
    pub(super) fn sig_of_constructor(
        &mut self,
        sym: Sym,
        file: FileId,
        class: ClassId,
        func: FnId,
    ) -> SigId {
        // `resolveAnonymousTypeMembers` instantiates the signatures with what the type parameters around the class stand for too,
        // and `instantiate_sig` only carries on what the mapper of a signature is about.
        let scope = self.bound(file).class_scope[class.idx()];
        let outer = if scope.is_some() {
            let parent = self.bound(file).scopes[scope.idx()].parent;
            self.identity_mapper(file, parent)
        } else {
            MapperId::IDENTITY
        };
        // Where an interface of the same name declares the type parameters the symbol goes by, those of the class stand for them.
        let own = self.decl_params_mapper(sym, file, self.hir(file)[class].type_params);
        let mapper = if own == MapperId::IDENTITY {
            outer
        } else {
            let mut pairs = self.p.types.mapping(outer).to_vec();
            pairs.extend_from_slice(self.p.types.mapping(own));
            self.p.types.mapper(pairs)
        };
        self.p.types.intern_sig(SigData::Construct {
            class: sym,
            file,
            func,
            mapper,
        })
    }

    /// `getSignatureOfFullSignatureType`: the signature a JSDoc `@type` tag gives `func` as a whole.
    pub(super) fn full_signature(&mut self, file: FileId, func: FnId) -> Option<SigId> {
        let hir = self.hir(file);
        let node = hir.jsdoc_type(JsDocTypeOwner::Fn(func));
        if node.is_none()
            || !matches!(
                hir[func].kind,
                FnKind::Decl | FnKind::Method | FnKind::Expr | FnKind::Arrow
            )
        {
            return None;
        }
        let ty = self.type_from_node(file, node);
        self.single_call_signature(ty, false)
    }

    /// `getSignaturesOfSymbol`: the signature the declaration `func` adds to its symbol.
    pub(super) fn sig_of_declaration(&mut self, file: FileId, func: FnId) -> SigId {
        match self.full_signature(file, func) {
            Some(full) => full,
            None => self.sig_of_fn(file, func),
        }
    }

    /// `getParameterTypeOfFullSignature`, of the parameter of `func` at `index`.
    pub(super) fn param_type_of_full_signature(
        &mut self,
        file: FileId,
        func: FnId,
        index: usize,
    ) -> Option<TypeId> {
        let sig = self.full_signature(file, func)?;
        let params = self.sig_params(sig);
        let hir = self.hir(file);
        if hir[hir[func].params.at(index)].flags.contains(Flags::REST) {
            return Some(self.params_as_tuple(&params, index));
        }
        Some(self.param_type_at(&params, index).unwrap_or(TypeId::ANY))
    }

    /// `getReturnTypeOfFullSignature`
    pub(super) fn return_type_of_full_signature(
        &mut self,
        file: FileId,
        func: FnId,
    ) -> Option<TypeId> {
        let sig = self.full_signature(file, func)?;
        Some(self.sig_return(sig))
    }

    /// The type parameters that are still to be given.
    #[inline]
    pub fn sig_type_params(&mut self, sig: SigId) -> List<'p, TypeId> {
        let recent = self.recent_sig_type_params[sig.0 as usize % RECENT_SIGS];
        if recent.0 == sig {
            return List::Kept(recent.1);
        }
        let params = self.sig_type_params_not_recent(sig);
        // What is kept somewhere holds for good.
        if let List::Kept(kept) = params {
            self.recent_sig_type_params[sig.0 as usize % RECENT_SIGS] = (sig, kept);
        }
        params
    }

    /// `sig_type_params`, of a signature that was not asked about lately.
    fn sig_type_params_not_recent(&mut self, sig: SigId) -> List<'p, TypeId> {
        match self.p.types.sig(sig) {
            SigData::Synth { type_params, .. } => return List::Kept(type_params),
            SigData::WithReturn { sig: inner, .. } => return self.sig_type_params(*inner),
            // Most functions have none.
            SigData::Decl { file, func, .. } if self.hir(*file)[*func].type_params.is_empty() => {
                return List::default();
            }
            _ => {}
        }
        if let Some(kept) = self.p.sig_type_params.get_ref(&sig) {
            return List::Kept(kept);
        }
        let before = self.what_only_holds_for_now();
        let params = self.sig_type_params_of_declaration(sig);
        if self.what_only_holds_for_now() == before {
            return List::Kept(self.p.sig_type_params.insert_ref(sig, params.into()).1);
        }
        List::Own(params)
    }

    #[inline(never)]
    fn sig_type_params_of_declaration(&mut self, sig: SigId) -> Vec<TypeId> {
        match self.p.types.sig(sig) {
            SigData::Decl { file, func, mapper } => {
                let (file, mapper) = (*file, *mapper);
                let params = self.hir(file)[*func].type_params;
                params
                    .iter()
                    .filter_map(|tp| {
                        if self.is_repeated_type_param(file, params, tp) {
                            return None;
                        }
                        let declared = self.type_param(file, tp);
                        match self.p.types.map(mapper, declared) {
                            None => Some(declared),
                            // `instantiateSignatureEx`: its own fresh parameter. The declared one is a type argument like any
                            // other: `f<T>(x)` inside `f`.
                            Some(given) => match *self.data(given) {
                                TypeData::TypeParam(f, t, around)
                                    if f == file && t == tp && around != MapperId::IDENTITY =>
                                {
                                    Some(given)
                                }
                                _ => None,
                            },
                        }
                    })
                    .collect()
            }
            SigData::Construct { class, mapper, .. }
            | SigData::DefaultConstruct { class, mapper, .. } => {
                let mapper = *mapper;
                let params = self.local_type_params_of_symbol(*class);
                params
                    .iter()
                    .copied()
                    .filter(|&tp| self.p.types.map(mapper, tp).is_none())
                    .collect()
            }
            SigData::Synth { type_params, .. } => type_params.to_vec(),
            SigData::WithReturn { sig: inner, .. } => {
                let inner = *inner;
                self.sig_type_params(inner).into_vec()
            }
        }
    }

    pub fn sig_decl(&self, sig: SigId) -> Option<(FileId, FnId, MapperId)> {
        match *self.p.types.sig(sig) {
            SigData::Decl { file, func, mapper }
            | SigData::Construct {
                file, func, mapper, ..
            } => Some((file, func, mapper)),
            SigData::WithReturn { sig: inner, .. } => self.sig_decl(inner),
            _ => None,
        }
    }

    /// `getDefaultConstructSignatures`: the base signature that the default construct signature `sig` clones, instantiated with the
    /// mapper of `sig`. Skips base classes that have no constructor either, so the result is never a default construct signature.
    /// Only the base constructor type counts: the base types may be empty (the base signature returns `any`, `object`, a type
    /// parameter). `None` if the base constructor type has no such signature.
    pub(super) fn default_construct_base_sig(&mut self, mut sig: SigId) -> Option<SigId> {
        loop {
            sig = match *self.p.types.sig(sig) {
                SigData::WithReturn { sig: inner, .. } => inner,
                SigData::DefaultConstruct { base, mapper, .. } => {
                    self.instantiate_sig(base?, mapper)
                }
                _ => return Some(sig),
            };
        }
    }

    #[inline]
    pub fn sig_params(&mut self, sig: SigId) -> List<'p, SigParam> {
        let recent = self.recent_sig_params[sig.0 as usize % RECENT_SIGS];
        if recent.0 == sig {
            return List::Kept(recent.1);
        }
        self.sig_params_not_recent(sig)
    }

    /// `kept` is what `sig_params` says of `sig`, for good.
    fn kept_sig_params(&mut self, sig: SigId, kept: &'p [SigParam]) -> List<'p, SigParam> {
        self.recent_sig_params[sig.0 as usize % RECENT_SIGS] = (sig, kept);
        List::Kept(kept)
    }

    /// `sig_params`, of a signature that was not asked about lately.
    fn sig_params_not_recent(&mut self, sig: SigId) -> List<'p, SigParam> {
        let (file, func, mapper) = match self.p.types.sig(sig) {
            SigData::WithReturn { sig: inner, .. } => return self.sig_params(*inner),
            SigData::Synth { params, .. } => return self.kept_sig_params(sig, params),
            // Nothing is kept for one of these.
            SigData::DefaultConstruct { .. } => {
                return match self.default_construct_base_sig(sig) {
                    Some(base) => self.sig_params(base),
                    None => List::default(),
                };
            }
            SigData::Decl { file, func, mapper }
            | SigData::Construct {
                file, func, mapper, ..
            } => (*file, *func, *mapper),
        };
        if let Some(kept) = self.p.sig_params.get_ref(&sig) {
            return self.kept_sig_params(sig, kept);
        }
        let before = self.what_only_holds_for_now();
        let params = self.sig_params_of_declaration(file, func, mapper);
        if self.what_only_holds_for_now() == before && params.iter().all(|p| self.is_known(p.ty)) {
            let kept = self.p.sig_params.insert_ref(sig, params.into()).1;
            return self.kept_sig_params(sig, kept);
        }
        List::Own(params)
    }

    #[inline(never)]
    fn sig_params_of_declaration(
        &mut self,
        file: FileId,
        func: FnId,
        mapper: MapperId,
    ) -> Vec<SigParam> {
        let hir = self.hir(file);
        let mut out = Vec::with_capacity(hir[func].params.len());
        // `getImmediatelyInvokedFunctionExpression`: how many arguments a function that is called where it is written is called with.
        let bound = self.bound(file);
        let given = bound
            .get_immediately_invoked_function_expression(hir, func)
            .map(|call| hir[call].args.len());
        // `SignatureFlagsIsUntypedSignatureInJSFile`, `getMinArgumentCount`: JavaScript that says nothing of its parameters, and of which
        // nothing is expected, can be called with as few arguments as one likes.
        let is_untyped_in_js = hir.is_js
            && given.is_none()
            && matches!(
                hir[func].kind,
                FnKind::Decl
                    | FnKind::Expr
                    | FnKind::Arrow
                    | FnKind::Method
                    | FnKind::Getter
                    | FnKind::Setter
                    | FnKind::Constructor
            )
            && hir[func].params.iter().all(|p| hir[p].ty.is_none())
            && match bound.fns[func.idx()].owner {
                crate::bind::FnOwner::Expr(e) => self.contextual_type(file, e).is_none(),
                _ => true,
            };
        for (i, p) in hir[func].params.iter().enumerate() {
            let param = &hir[p];
            let name = match hir[param.pat].kind {
                PatKind::Ident(name) => name,
                _ => Atom::NONE,
            };
            // TypeScript looks at the type of a parameter when there is an argument to hold against it.
            self.eager.push(self.stack.len());
            let declared = self.type_of_param(file, p);
            self.eager.pop();
            // `isOptionalParameter`: nobody else calls it, so what it is not given it does not need.
            let is_left_out = given.is_some_and(|given| i >= given)
                && param.ty.is_none()
                && !param.flags.contains(Flags::REST);
            let optional =
                param.flags.contains(Flags::OPTIONAL) || param.default.is_some() || is_left_out;
            // Seen from outside, what may be left out may as well be given as `undefined`.
            let declared = if optional {
                self.optional(declared)
            } else {
                declared
            };
            out.push(SigParam {
                name,
                ty: self.instantiate(declared, mapper),
                optional: optional || is_untyped_in_js && !param.flags.contains(Flags::REST),
                rest: param.flags.contains(Flags::REST),
                has_declaration: true,
            });
        }
        out
    }

    pub fn sig_return(&mut self, sig: SigId) -> TypeId {
        match *self.p.types.sig(sig) {
            SigData::Synth { ret, .. } | SigData::WithReturn { ret, .. } => ret,
            SigData::Decl { file, func, mapper } => {
                let declared = self.return_type_of_fn(file, func);
                self.instantiate_result_of_sig(declared, file, func, mapper)
            }
            SigData::Construct { class, mapper, .. }
            | SigData::DefaultConstruct { class, mapper, .. } => {
                let declared = self.declared_type(class);
                self.instantiate(declared, mapper)
            }
        }
    }

    /// `getThisTypeOfSignature`: what it is to be called on, whatever made the signature.
    pub fn sig_this_type(&mut self, sig: SigId) -> Option<TypeId> {
        let (file, func, mapper) = match *self.p.types.sig(sig) {
            SigData::WithReturn { sig: inner, .. } => return self.sig_this_type(inner),
            SigData::Synth { this, .. } => return this,
            SigData::Decl { file, func, mapper } => (file, func, mapper),
            _ => return None,
        };
        let f = &self.hir(file)[func];
        if f.this_ty.is_none() && f.this_pos == u32::MAX {
            return None;
        }
        let declared = self.type_of_this_parameter(file, func);
        Some(self.instantiate(declared, mapper))
    }

    pub fn sig_predicate(&mut self, sig: SigId) -> Option<Predicate> {
        let (file, func, mapper) = match *self.p.types.sig(sig) {
            SigData::WithReturn { sig: inner, .. } => return self.sig_predicate(inner),
            SigData::Synth { ref of, .. } if of.len() > 1 => return self.union_sig_predicate(of),
            SigData::Decl { file, func, mapper } => (file, func, mapper),
            _ => return None,
        };
        let hir = self.hir(file);
        let f = &hir[func];
        if f.ret.is_none() {
            return self.inferred_predicate(file, func).map(|mut p| {
                p.ty =
                    p.ty.map(|t| self.instantiate_result_of_sig(t, file, func, mapper));
                p
            });
        }
        let TypeNodeKind::Predicate { param, ty, asserts } = hir[f.ret].kind else {
            return None;
        };
        let index =
            if param == known::this {
                None
            } else {
                Some(f.params.iter().position(
                    |p| matches!(hir[hir[p].pat].kind, PatKind::Ident(n) if n == param),
                )?)
            };
        let ty = if ty.is_some() {
            let declared = self.type_from_node(file, ty);
            Some(self.instantiate_result_of_sig(declared, file, func, mapper))
        } else {
            None
        };
        Some(Predicate {
            param: index,
            ty,
            asserts,
        })
    }

    /// `getUnionOrIntersectionTypePredicate`, of the signature of a union that stands for `sigs`.
    fn union_sig_predicate(&mut self, sigs: &[SigId]) -> Option<Predicate> {
        let mut last: Option<Predicate> = None;
        let mut types = Vec::with_capacity(sigs.len());
        for &sig in sigs {
            match self.sig_predicate(sig) {
                // All have to be about the same thing, and nothing is made of assertions.
                Some(predicate) => {
                    let differs = last.is_some_and(|last| last.param != predicate.param);
                    if predicate.asserts || differs {
                        return None;
                    }
                    types.push(predicate.ty?);
                    last = Some(predicate);
                }
                // One that returns `false` is passed over.
                None => {
                    if !matches!(self.sig_return(sig), TypeId::FALSE | TypeId::FRESH_FALSE) {
                        return None;
                    }
                }
            }
        }
        let last = last?;
        let ty = self.union(&types);
        Some(Predicate {
            ty: Some(ty),
            ..last
        })
    }

    pub fn min_args(params: &[SigParam]) -> usize {
        params
            .iter()
            .rposition(|p| !p.optional && !p.rest)
            .map_or(0, |i| i + 1)
    }

    /// The type of the argument at `index`, going into a rest parameter if it gets that far.
    pub fn param_type_at(&mut self, params: &[SigParam], index: usize) -> Option<TypeId> {
        let last = params.last()?;
        if index < params.len() - usize::from(last.rest) {
            let p = &params[index];
            return Some(p.ty);
        }
        if !last.rest {
            return None;
        }
        let offset = index - (params.len() - 1);
        // `tryGetTypeAtPosition`: past the end of a tuple of fixed length there is no parameter.
        if let TypeData::Tuple { elems, flags, .. } = self.data(last.ty)
            && offset >= elems.len()
            && !flags
                .iter()
                .any(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
        {
            return None;
        }
        Some(self.rest_element_type(last.ty, offset))
    }

    /// What element `offset` of the array or tuple a rest parameter is declared as holds.
    pub fn rest_element_type(&mut self, rest: TypeId, offset: usize) -> TypeId {
        if let Some(element) = self.array_element(rest) {
            return element;
        }
        match self.data(rest) {
            TypeData::Tuple { elems, flags, .. } => {
                if let Some(&e) = elems.get(offset)
                    && !flags[..=offset]
                        .iter()
                        .any(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
                {
                    return if flags[offset].contains(ElemFlags::OPTIONAL) {
                        self.optional_property(e)
                    } else {
                        e
                    };
                }
                match flags
                    .iter()
                    .position(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
                {
                    Some(first) => {
                        // `shouldDeferIndexedAccessType`: with a `...T` in it, only what is within the fixed elements of both ends
                        // can be told.
                        let fixed_at_end = flags
                            .iter()
                            .rev()
                            .take_while(|f| !f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
                            .count();
                        if flags.iter().any(|f| f.contains(ElemFlags::VARIADIC))
                            && offset >= first + fixed_at_end
                        {
                            return TypeId::UNRESOLVED;
                        }
                        // `getRestTypeOfTupleType`: from the first element that stands for any number on, it can be any of them.
                        self.tuple_element_union(&elems[first..], &flags[first..])
                    }
                    None => TypeId::UNRESOLVED,
                }
            }
            _ if self.is_any(rest) => rest,
            _ => {
                let index = self.number_literal(offset as f64, false);
                self.indexed_access(rest, index)
            }
        }
    }
}
