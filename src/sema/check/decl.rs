//! Resolves declarations and type nodes to types.

use super::errors_enums_names::{Location, is_ambient_enum, is_declared_before_use};
use super::errors_names_and_exports::fully_qualified_name_of;
use super::*;
use crate::bind::{Decl, PatParent, ScopeId, ScopeKind};
use smallvec::SmallVec;

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Predicate {
    /// The index of the parameter it is about. `None`: `this`. `NO_PARAMETER`: the name is that of
    /// no parameter (1225).
    pub param: Option<usize>,
    /// `None` for `asserts x`.
    pub ty: Option<TypeId>,
    pub asserts: bool,
}

impl Predicate {
    /// `parameterIndex` -1
    pub const NO_PARAMETER: usize = usize::MAX;
}

/// The enclosing type parameters that a piece of type syntax may reference.
#[derive(Default)]
struct Mentioned {
    /// The names of the enclosing type parameters. A type reference with any other name is not
    /// resolved.
    candidates: SmallVec<[Atom; 8]>,
    /// The symbols that the type references with those names resolve to, and the type parameters
    /// declared by `infer`.
    type_params: SmallVec<[Sym; 8]>,
    this: bool,
    /// The scopes that declare the values queried with `typeof`: their types can involve the type
    /// parameters visible from there.
    values_in: Vec<(FileId, ScopeId)>,
    /// The references cannot be determined.
    everything: bool,
    /// `getOuterTypeParameters`: the `infer` type parameters of the conditional types around the
    /// syntax. `isTypeParameterPossiblyReferenced` never reaches their container, an `infer` type.
    inferred_around: SmallVec<[TypeId; 4]>,
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
#[derive(Copy, Clone, Default, PartialEq)]
pub(super) struct Evaluated {
    pub(super) value: Option<EnumValue>,
    pub(super) is_syntactically_string: bool,
    pub(super) resolved_other_files: bool,
    pub(super) has_external_references: bool,
}

crate::types::follow_struct!(Evaluated {
    value,
    is_syntactically_string,
    resolved_other_files,
    has_external_references,
});

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

impl<'p, 's> Checker<'p, 's> {
    /// `evaluate`. `location`: the declaration `e` is evaluated for, the enum member or constant
    /// whose initializer it is (part of), or else the queried expression. Parentheses are not in
    /// the HIR, and nothing else is skipped.
    pub(super) fn evaluate(&mut self, file: FileId, e: ExprId, location: Location) -> Evaluated {
        if self.is_stack_low() {
            self.bailed_out();
            return Evaluated::default();
        }
        let hir = self.hir(file);
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
            // An assignment is a `BinaryExpression` with an operator that yields no value.
            ExprKind::Assign { target, value, .. } => {
                self.evaluate_binary(file, None, target, value, location)
            }
            ExprKind::String(text) => Evaluated {
                value: Some(EnumValue::String(text)),
                is_syntactically_string: true,
                ..Evaluated::default()
            },
            // `evaluateTemplateExpression`
            ExprKind::Template { exprs } => {
                let (atoms, texts) = (&self.atoms(), hir.template_texts(exprs));
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
                    text.extend_from_slice(self.constant_text(value));
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
                let text = [self.constant_text(a), self.constant_text(b)].concat();
                Some(EnumValue::String(self.atoms().intern(&text)))
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

    /// `evaluateEntity`: by the symbols the names resolve to, never by the type of the expression.
    fn evaluate_entity(&mut self, file: FileId, e: ExprId, location: Location) -> Evaluated {
        let (hir, files) = (self.hir(file), self.files());
        if let ExprKind::Index { obj, index, .. } = hir[e].kind {
            let name = match hir[index].kind {
                ExprKind::String(name) => name,
                ExprKind::Template { exprs } if exprs.is_empty() => {
                    hir.id_at(hir.template_texts(exprs), 0)
                }
                _ => return Evaluated::default(),
            };
            // Neither `(a)["b"]` nor `a[("b")]`.
            if is_parenthesized(hir, index) || !is_entity_name_expression(hir, obj) {
                return Evaluated::default();
            }
            if let Some(root) = self.resolve_entity_name_expression(file, obj, SymFlags::VALUE)
                && files.flags(root).intersects(SymFlags::ENUM)
                && let Some(member) = files.export(root, name)
                && files.flags(member).contains(SymFlags::ENUM_MEMBER)
            {
                return self.evaluate_enum_member(file, e, member, location);
            }
            return Evaluated::default();
        }
        let Some(symbol) = self.resolve_entity_name_expression(file, e, SymFlags::VALUE) else {
            return Evaluated::default();
        };
        // `Infinity` and `NaN`, unless they are shadowed.
        if let ExprKind::Ident(name) = hir[e].kind
            && let Some(n) = match self.atoms().bytes(name) {
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
        // There is no declaration order between files: constants of two files may be initialized
        // with each other.
        if self.constant_depth <= 16
            && let Some((of, d)) = self.constant_variable_declaration(symbol, location)
        {
            self.constant_depth += 1;
            let result = self.evaluate(of, self.hir(of)[d].init, Location::Variable(of, d));
            self.constant_depth -= 1;
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
            let at = self.place_of_expr(file, e);
            self.error_at(at, 2565, &[Arg::Sym(symbol)]);
            return Evaluated::default();
        };
        if !is_declared_before_use(self, Location::Member(of, member), location) {
            let at = self.place_of_expr(file, e);
            self.error_at(at, 2651, &[]);
            return Evaluated::number(0.0);
        }
        let value = self.enum_member_value_at(of, member, location);
        // `location.Parent != declaration.Parent`
        let owner = &self.bound(of).enum_member_owner;
        let is_of_the_same_enum = matches!(location, Location::Member(file, using)
            if file == of && owner[using.idx()] == owner[member.idx()]);
        Evaluated {
            has_external_references: value.has_external_references || !is_of_the_same_enum,
            ..value
        }
    }

    /// `computeEnumMemberValues` processes a declaration in order: in an ambient context, where
    /// declaration order is not enforced, a later member of the declaration in progress has no
    /// value yet.
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

/// `EnumLiteralKey`: the key by which two enum member values are compared. `0` and `-0` are equal,
/// and there is one `NaN`.
fn enum_value_key(value: EnumValue) -> EnumValue {
    match value {
        EnumValue::Number(bits) if f64::from_bits(bits) == 0.0 => EnumValue::Number(0f64.to_bits()),
        EnumValue::Number(bits) if f64::from_bits(bits).is_nan() => {
            EnumValue::Number(f64::NAN.to_bits())
        }
        _ => value,
    }
}

/// `isVariadicTupleElement`: `...T` where `T` is not an array type node.
pub(super) fn is_variadic_tuple_element(hir: &hir::File, elem: &TupleElem) -> bool {
    elem.rest && elem.ty.is_some() && array_element_type_node(hir, elem.ty).is_none()
}

/// `getTupleElementInfo`
fn tuple_element_info(hir: &hir::File, elem: &TupleElem) -> ElemFlags {
    let flags = if elem.rest && array_element_type_node(hir, elem.ty).is_none() {
        ElemFlags::VARIADIC
    } else if elem.rest {
        ElemFlags::REST
    } else if elem.optional {
        ElemFlags::OPTIONAL
    } else {
        ElemFlags::REQUIRED
    };
    flags.with_label(elem.name)
}

/// Every declaration of `sym`, which is canonical: what `Files::decls` lists, one at a time.
pub(super) fn declarations_of<'a>(
    files: &'a Files<'_>,
    sym: Sym,
) -> impl Iterator<Item = (FileId, Decl)> + 'a {
    files.parts(sym).into_iter().flat_map(move |part| {
        files
            .symbol(part)
            .decls
            .iter()
            .map(move |&decl| (part.file, decl))
    })
}

impl<'p, 's> Checker<'p, 's> {
    // ───────────────────────────── type parameters in scope ─────────────────────────────

    /// The type parameters that can be referenced in `scope`, outermost first.
    pub fn outer_type_params(&mut self, file: FileId, scope: ScopeId) -> &'p [TypeId] {
        if scope.is_none() {
            return &[];
        }
        self.cached_outer_type_params(file, scope)
    }

    /// The same, for callers that only read them.
    pub(super) fn type_params_in_scope(&mut self, file: FileId, scope: ScopeId) -> &'p [TypeId] {
        if scope.is_none() || self.declares_no_type_params(file) {
            return &[];
        }
        self.cached_outer_type_params(file, scope)
    }

    /// Whether no type parameter is visible in any scope of `file`, including the `this` types of
    /// classes and interfaces.
    #[inline]
    fn declares_no_type_params(&self, file: FileId) -> bool {
        let hir = self.hir(file);
        hir.type_params.is_empty() && hir.classes.is_empty() && hir.interfaces.is_empty()
    }

    fn cached_outer_type_params(&mut self, file: FileId, scope: ScopeId) -> &'p [TypeId] {
        let p = self.p;
        if let Some(known) = p.outer_type_params.get_ref(&self.task, &(file, scope)) {
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
                | ScopeKind::TypeAlias(_)
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
        own.sort_unstable_by_key(|own| own.0);
        let this = match s.kind {
            ScopeKind::Class(c) => Some(self.files().sym(file, bound.class_symbol[c.idx()])),
            ScopeKind::Interface(i) => {
                Some(self.files().sym(file, bound.interface_symbol[i.idx()]))
            }
            _ => None,
        };
        let this = this.map(|this| self.intern(TypeData::ThisParam(this)));
        let own = own.iter().map(|o| o.1);
        let result = self.list_of(outer.iter().copied().chain(own).chain(this));
        p.outer_type_params
            .insert_ref(&self.task, (file, scope), result, Stored::new())
    }

    /// Maps every type parameter in scope to itself.
    pub fn identity_mapper(&mut self, file: FileId, scope: ScopeId) -> MapperId {
        if scope.is_none() || self.declares_no_type_params(file) {
            return MapperId::IDENTITY;
        }
        if let Some(kept) = self.p.identity_mappers.get(&self.task, &(file, scope)) {
            return kept;
        }
        let params = self.type_params_in_scope(file, scope);
        let mapper = if params.is_empty() {
            MapperId::IDENTITY
        } else {
            self.types()
                .mapper(params.iter().map(|&p| (p, p)).collect())
        };
        (self.p.identity_mappers).insert(&self.task, (file, scope), mapper, Stored::new())
    }

    /// `getOuterTypeParameters`: also those that a context sensitive function enclosing `scope` has
    /// adopted.
    pub(super) fn identity_mapper_with_adopted(
        &mut self,
        file: FileId,
        scope: ScopeId,
    ) -> MapperId {
        let declared = self.identity_mapper(file, scope);
        let (hir, bound) = (self.hir(file), self.bound(file));
        // For speed: only a function with a contextual type adopts anything.
        let mut at = scope;
        loop {
            if at.is_none() {
                return declared;
            }
            let s = &bound.scopes[at.idx()];
            if let ScopeKind::Fn(f) = s.kind
                && hir[f].type_params.is_empty()
                && self.takes_context(file, f).is_some()
            {
                break;
            }
            at = s.parent;
        }
        let known = (self.p.identity_mappers_with_adopted).get(&self.task, &(file, scope));
        if let Some(kept) = known {
            return kept;
        }
        let computation = self.begin_scope();
        let adopted = self.adopted_type_params_in_scope(file, scope, u32::MAX);
        let mapper = if adopted.is_empty() {
            declared
        } else {
            let mut pairs = self.types().mapping(declared).to_vec();
            pairs.extend(adopted.into_iter().map(|param| (param, param)));
            self.types().mapper(pairs)
        };
        match self.end_scope_by_counters(computation) {
            Ok(stored) => (self.p.identity_mappers_with_adopted).insert(
                &self.task,
                (file, scope),
                mapper,
                stored,
            ),
            Err(_) => mapper,
        }
    }

    /// `isTypeParameterPossiblyReferenced`: an identity mapper for the type parameters in scope
    /// that are in `mentioned`, or that count as referenced because of where they are declared. A
    /// type inside a generic declaration that does not reference its parameters is not generic.
    /// `pos`: its position.
    fn identity_mapper_of_mentioned(
        &mut self,
        file: FileId,
        scope: ScopeId,
        pos: u32,
        mentioned: &Mentioned,
    ) -> MapperId {
        let mapper = self.identity_mapper_of_mentioned_in_scope(file, scope, pos, mentioned);
        if mentioned.inferred_around.is_empty() {
            return mapper;
        }
        // In the true branch they are in scope.
        let mapping = self.types().mapping(mapper);
        let is_missing = |param: &&TypeId| !mapping.iter().any(|pair| pair.0 == **param);
        let mut pairs = mapping.to_vec();
        pairs.extend(
            (mentioned.inferred_around.iter())
                .filter(is_missing)
                .map(|&p| (p, p)),
        );
        self.types().mapper(pairs)
    }

    fn identity_mapper_of_mentioned_in_scope(
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
        // The outermost come first, so those that count because of where they are declared form a
        // prefix.
        let mut taken = self.params_beyond_a_block(file, scope, pos);
        for &(of, declared_in) in &mentioned.values_in {
            let seen = self.type_params_in_scope(of, declared_in).len();
            // A declaration of the method in another file: what is visible from there is not what
            // is visible from `scope`.
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
                        // `getDeclaredTypeOfClassOrInterface`: a class, and anything generic, has a
                        // `this` type.
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
            self.types().mapper(pairs)
        }
    }

    /// `len(tp.symbol.Declarations) == 1`. `infer U` occurring twice is one symbol of its scope.
    /// The type parameters of a class or an interface are among its members.
    fn type_param_has_one_declaration(&self, file: FileId, tp: TypeParamId) -> bool {
        let bound = self.bound(file);
        let symbol = bound.type_param_symbol[tp.idx()];
        let files = self.files();
        symbol.is_none() || files.decls_of(files.sym(file, symbol)).len() == 1
    }

    fn type_param_names_in_scope(&mut self, file: FileId, scope: ScopeId) -> SmallVec<[Atom; 8]> {
        let params = self.type_params_in_scope(file, scope);
        params
            .iter()
            .filter_map(|&p| Some(self.type_param_decl(p)?.1.name))
            .collect()
    }

    /// The number of `outer_type_params(file, scope)`, outermost first, that have a statement block
    /// between their declaration and `pos`: `isTypeParameterPossiblyReferenced` treats those as
    /// referenced.
    fn params_beyond_a_block(&mut self, file: FileId, mut scope: ScopeId, pos: u32) -> usize {
        let (hir, bound) = (self.hir(file), self.bound(file));
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            match s.kind {
                ScopeKind::Block => return self.type_params_in_scope(file, scope).len(),
                ScopeKind::Fn(f) => {
                    // The body of a function shares its scope with the signature: distinguished by
                    // its start position.
                    if let FnBody::Block(stmts) = hir[f].body
                        && hir
                            .ids(stmts)
                            .next()
                            .is_some_and(|first| pos >= hir[first].start)
                    {
                        return self.type_params_in_scope(file, scope).len();
                    }
                    // The separate scope for the name of a function expression is not a block.
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

    /// The types in the JSDoc comments of `file` that `checkSourceFile` never reaches: those of the
    /// `@type` tags for which TypeScript has no annotation (`jsdoc_types`), and the `T` of `T=` and
    /// `...T`. `getTypeFromTypeNode` resolves them as far as something asks, so a pass over all
    /// nodes of a file skips what they contain.
    pub(super) fn unchecked_jsdoc_types(&self, file: FileId) -> Places {
        let hir = self.hir(file);
        if !hir.is_js {
            return Places::new(std::iter::empty());
        }
        let assigned = hir.jsdoc_types.iter().map(|assigned| assigned.1);
        let operands = hir.types.iter().filter_map(|node| match node.kind {
            TypeNodeKind::JSDoc {
                ty,
                kind: JSDocTypeKind::Optional | JSDocTypeKind::Variadic,
                ..
            } => Some(ty),
            _ => None,
        });
        Places::new(assigned.chain(operands).map(|ty| TextRange {
            pos: hir[ty].pos,
            end: hir[ty].end,
        }))
    }

    /// `getAliasSymbolForTypeNode`: the type alias declaration whose body is `node`, which is in
    /// `scope`. A `readonly` operator around `node` is skipped.
    pub(super) fn alias_with_body(
        &self,
        file: FileId,
        scope: ScopeId,
        node: TypeNodeId,
    ) -> Option<AliasId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !bound.type_by_alias[node.idx()] {
            return None;
        }
        let ScopeKind::TypeAlias(alias) = bound.scopes[scope.idx()].kind else {
            return None;
        };
        let mut body = hir[alias].ty;
        while body.is_some()
            && let TypeNodeKind::Readonly(operand) = hir[body].kind
        {
            body = operand;
        }
        (body == node).then_some(alias)
    }

    /// Whether `node`, in `scope`, is the body of a type alias that has type parameters.
    fn is_body_of_generic_alias(&self, file: FileId, scope: ScopeId, node: TypeNodeId) -> bool {
        self.alias_with_body(file, scope, node)
            .is_some_and(|alias| !self.hir(file)[alias].type_params.is_empty())
    }

    /// The body of the type alias whose type parameters `scope` declares, if that is an
    /// intersection type node and `node` is the first of its members that stores a mapper.
    fn intersection_alias_body_pinned_by(
        &self,
        file: FileId,
        scope: ScopeId,
        node: TypeNodeId,
    ) -> Option<TypeNodeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ScopeKind::TypeAlias(alias) = bound.scopes[scope.idx()].kind else {
            return None;
        };
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
        let declared = self.identity_mapper_of_declared_for_node(file, scope, node);
        let adopted = self.adopted_type_params_in_scope(file, scope, self.hir(file)[node].pos);
        if adopted.is_empty() {
            return declared;
        }
        let mut pairs = self.types().mapping(declared).to_vec();
        pairs.extend(adopted.into_iter().map(|param| (param, param)));
        self.types().mapper(pairs)
    }

    /// `getOuterTypeParameters`: a context sensitive function expression, arrow function or object
    /// literal method has the type parameters of its contextual signature
    /// (`assignContextualParameterTypes`). Returns those of the functions whose bodies contain
    /// `pos`, in `scope`. `isTypeParameterPossiblyReferenced` is true for all of them: walking up
    /// from a node it never reaches their declaration.
    fn adopted_type_params_in_scope(
        &mut self,
        file: FileId,
        mut scope: ScopeId,
        pos: u32,
    ) -> Vec<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut adopted = Vec::new();
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            if let ScopeKind::Fn(f) = s.kind
                && hir[f].type_params.is_empty()
                && self.takes_context(file, f).is_some()
                && match hir[f].body {
                    FnBody::Block(stmts) => hir
                        .ids(stmts)
                        .next()
                        .is_some_and(|first| pos >= hir[first].start),
                    FnBody::Expr(body) => pos >= hir[body].pos,
                    FnBody::None => false,
                }
            {
                let sig = self.sig_of_fn(file, f);
                adopted.extend(self.adopted_type_params(sig));
            }
            scope = s.parent;
        }
        adopted
    }

    fn identity_mapper_of_declared_for_node(
        &mut self,
        file: FileId,
        scope: ScopeId,
        node: TypeNodeId,
    ) -> MapperId {
        let is_in_conditional_type = self.has_conditional_or_mapped_type(file)
            && self.is_in_conditional_type_with_infer(file, node);
        if self.type_params_in_scope(file, scope).is_empty() && !is_in_conditional_type {
            return MapperId::IDENTITY;
        }
        // `getObjectTypeInstantiation`, `getTypeFromConditionalTypeNode`: the type a generic alias
        // refers to depends on all of them, referenced or not.
        if self.is_body_of_generic_alias(file, scope, node) {
            return self.identity_mapper(file, scope);
        }
        let mut mentioned = Mentioned {
            candidates: self.type_param_names_in_scope(file, scope),
            ..Mentioned::default()
        };
        self.collect_mentions(file, node, &mut mentioned);
        self.collect_mentions_of_extends_types_around(file, node, &mut mentioned);
        if is_in_conditional_type {
            self.collect_infer_params_around(file, node, &mut mentioned);
        }
        let mapper =
            self.identity_mapper_of_mentioned(file, scope, self.hir(file)[node].pos, &mentioned);
        // `getIntersectionType`: the alias and all its type arguments are part of the identity of
        // the type (`getAliasKey`). Where the body omits a type parameter, one member carries it
        // instead.
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

    /// The same for the declarations of a method. The inferred return type of a body can involve
    /// anything in scope.
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
            .map_or(0, |&(f, func)| self.hir(f)[func].start);
        self.identity_mapper_of_mentioned(file, scope, pos, &mentioned)
    }

    /// `isTypeParameterPossiblyReferenced`, `IsConditionalTypeNode(n) &&
    /// ForEachChild(n.ExtendsType, containsReference)` walking up from `node`: the `extends` type
    /// of a conditional type appears in the substitution types below it.
    fn collect_mentions_of_extends_types_around(
        &self,
        file: FileId,
        mut node: TypeNodeId,
        out: &mut Mentioned,
    ) {
        if !self.has_conditional_or_mapped_type(file) {
            return;
        }
        while let Some(parent) = Self::type_node_parent(self.hir(file), node).some() {
            if let TypeNodeKind::Cond { extends, .. } = self.hir(file)[parent].kind {
                self.collect_mentions(file, extends, out);
            }
            node = parent;
        }
    }

    /// Whether a conditional type around `node` has an `infer` type.
    fn is_in_conditional_type_with_infer(&self, file: FileId, mut node: TypeNodeId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        while let Some(parent) = Self::type_node_parent(hir, node).some() {
            if let TypeNodeKind::Cond { extends, .. } = hir[parent].kind
                && bound.type_scope[extends.idx()].is_some()
            {
                return true;
            }
            node = parent;
        }
        false
    }

    fn collect_infer_params_around(
        &mut self,
        file: FileId,
        mut node: TypeNodeId,
        out: &mut Mentioned,
    ) {
        let mut declared = Vec::new();
        while let Some(parent) = Self::type_node_parent(self.hir(file), node).some() {
            if let TypeNodeKind::Cond { extends, .. } = self.hir(file)[parent].kind {
                self.collect_infer_params(file, extends, &mut declared);
            }
            node = parent;
        }
        for tp in declared {
            let param = self.type_param(file, tp);
            out.inferred_around.push(param);
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
            // Without an annotation, its type comes from a default or from the contextual type.
            if hir[p].ty.is_none() && !matches!(f.body, FnBody::None) {
                out.everything = true;
                return;
            }
            self.collect_mentions(file, hir[p].ty, out);
        }
        self.collect_mentions(file, f.this_ty(hir), out);
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
            | TypeNodeKind::Heritage(_)
            | TypeNodeKind::StringLit(_)
            | TypeNodeKind::NumberLit(_)
            | TypeNodeKind::BigIntLit { .. }
            | TypeNodeKind::BoolLit(_)
            | TypeNodeKind::UniqueSymbol => {}
            TypeNodeKind::Keyword(keyword) => out.this |= keyword == Keyword::This,
            TypeNodeKind::Ref { name, args } => {
                if name.len() == 1 {
                    let name = hir.texts(name).next().unwrap();
                    // `getSymbolFromTypeReference`: an inner type parameter can shadow an outer one
                    // of the same name.
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
            TypeNodeKind::Array(t)
            | TypeNodeKind::Keyof(t)
            | TypeNodeKind::Readonly(t)
            | TypeNodeKind::JSDoc { ty: t, .. } => self.collect_mentions(file, t, out),
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
            // `isTypeParameterPossiblyReferenced`: the type of a value can involve the type
            // parameters that enclose its declaration.
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
                // Nothing in the file declares it: its declaration has no enclosing type parameter.
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

    /// `getLocalTypeParametersOfClassOrInterfaceOrTypeAlias`: the type parameters of all the
    /// declarations of a class, an interface or an alias, in order of first occurrence. Those with
    /// the same name are one type parameter.
    pub fn type_params_of_symbol(&self, sym: Sym) -> List<'p, TypeId> {
        List::Own(self.local_type_params_of_symbol(sym).into_vec())
    }

    /// The same, for callers that only read them.
    pub(super) fn local_type_params_of_symbol(&self, sym: Sym) -> SmallVec<[TypeId; 4]> {
        if let Some((file, params)) = self.files().only_type_param_list(sym) {
            return params
                .iter()
                .filter(|&tp| !self.is_repeated_type_param(file, params, tp))
                .map(|tp| self.type_param(file, tp))
                .collect();
        }
        let lists = self.files().type_param_lists(sym);
        if let [(file, params)] = lists[..] {
            return params
                .iter()
                .filter(|&tp| !self.is_repeated_type_param(file, params, tp))
                .map(|tp| self.type_param(file, tp))
                .collect();
        }
        // Each declaration has its own type parameters here. They are taken from a single
        // declaration as far as it has them, so that whatever a constraint or a default references
        // is among them: the declaration with the most, and among those the first that specifies
        // defaults.
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

    /// The scope that the declaration `i` of an interface creates.
    fn interface_scope(&self, file: FileId, i: InterfaceId) -> ScopeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let decl = &hir[i];
        // A node inside it has its scope recorded.
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
        bound.interface_scope[i.idx()]
    }

    /// `getOuterTypeParametersOfClassOrInterface`: the type parameters of the declarations that
    /// enclose `sym`, outermost first, without the `this` types.
    pub fn outer_type_params_of_symbol(&mut self, sym: Sym) -> List<'p, TypeId> {
        let symbol = self.files().symbol(sym);
        // A merged symbol is declared at the top level of a file or of a namespace in each of its
        // declarations.
        if symbol.flags.contains(SymFlags::MERGED) {
            return List::default();
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
            return List::default();
        };
        let all = self.outer_type_params(file, bound.scopes[own.idx()].parent);
        if !all
            .iter()
            .any(|&p| matches!(self.data(p), TypeData::ThisParam(_)))
        {
            return List::Kept(all);
        }
        let others = all.iter().copied();
        List::Own(
            others
                .filter(|&p| !matches!(self.data(p), TypeData::ThisParam(_)))
                .collect(),
        )
    }

    /// The type parameters that the `args` of a `TypeData::Ref` to `sym` correspond to: the outer
    /// ones of the declaration, then its own.
    pub fn all_type_params_of_symbol(&mut self, sym: Sym) -> List<'p, TypeId> {
        self.listed_type_params_of_symbol(sym)
    }

    /// The same, for callers that only read them.
    pub(super) fn listed_type_params_of_symbol(&mut self, sym: Sym) -> List<'p, TypeId> {
        if self
            .files()
            .flags(sym)
            .intersects(SymFlags::CLASS | SymFlags::INTERFACE)
        {
            // The declared type has them as its type arguments.
            let declared = self.declared_type(sym);
            if matches!(self.data(declared), TypeData::Ref { .. }) {
                return List::Kept(self.type_arguments(declared));
            }
        }
        List::Own(self.local_type_params_of_symbol(sym).into_vec())
    }

    pub(super) fn type_argument_arity(&self, sym: Sym) -> (usize, usize) {
        self.files().type_argument_arity(sym)
    }

    pub(super) fn type_param_decl(&self, param: TypeId) -> Option<(FileId, &'p TypeParam)> {
        match *self.data(param) {
            TypeData::TypeParam(file, tp, _) => Some((file, &self.hir(file)[tp])),
            _ => None,
        }
    }

    /// `getConstraintOfTypeParameter`. Returns `None` for a circular constraint.
    pub fn constraint_of_type_param(&mut self, param: TypeId) -> Option<TypeId> {
        if let Some(kept) = self.p.type_param_constraints.get(&self.task, &param) {
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
                let (before, scope) = (self.non_cacheable_mark(), self.begin_scope());
                let constraint = self.resolve_constraint_of_type_param(param, file, tp, around);
                let ended = self.end_scope(scope);
                if self.non_cacheable_mark() == before
                    && let Ok(stored) = ended
                {
                    self.p
                        .type_param_constraints
                        .insert(&self.task, param, constraint, stored);
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
        if self.has_circular_base_constraint(param, constraint) {
            return None;
        }
        // `getTypeFromMappedTypeNode` resolves the constraint of its key eagerly when the mapped
        // type is created, so a cycle can pass through the key of a mapped type inside the
        // constraint.
        if around == MapperId::IDENTITY
            && !self.hir(file).mapped.is_empty()
            && self.has_type_variables(constraint)
            && self.is_constraint_circular(file, tp)
        {
            return None;
        }
        Some(constraint)
    }

    /// `getConstraintFromTypeParameter`: the same, whether or not it is circular.
    pub(super) fn constraint_from_type_param(&mut self, param: TypeId) -> Option<TypeId> {
        let TypeData::TypeParam(file, tp, around) = *self.data(param) else {
            return None;
        };
        // The constraint of a cloned type parameter is the declared constraint instantiated with
        // the mapper of the clone.
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
            return self.inferred_type_param_constraint(param, file, tp, false);
        }
        let mut constraint = self.type_from_node(of, node);
        // A constraint of `any` is no constraint. The key type of a mapped type is still
        // constrained to keys.
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

    /// `hasNonCircularBaseConstraint`, negated, following only type parameters, unions,
    /// intersections, the placeholders of template literal types, the operands of string mappings
    /// and the check types of distributive conditional types.
    pub(super) fn has_circular_base_constraint(
        &mut self,
        param: TypeId,
        constraint: TypeId,
    ) -> bool {
        if !matches!(
            self.data(constraint),
            TypeData::TypeParam(..)
                | TypeData::Union(_)
                | TypeData::Intersection(_)
                | TypeData::Template { .. }
                | TypeData::StringMapping { .. }
                | TypeData::Cond { .. }
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
                TypeData::Union(parts)
                | TypeData::Intersection(parts)
                | TypeData::Template { types: parts, .. } => todo.extend(
                    parts
                        .iter()
                        .copied()
                        .filter(|&part| self.has_type_variables(part)),
                ),
                TypeData::StringMapping { ty, .. } => todo.push(*ty),
                // `getConstraintOfDistributiveConditionalType`
                &TypeData::Cond { file, node, .. } => {
                    if self.is_distributive_conditional(file, node) {
                        todo.push(self.cond_check(t));
                    }
                }
                TypeData::TypeParam(..) if !seen.contains(&t) => {
                    seen.push(t);
                    // The constraints of the other type parameters are only inspected to follow the
                    // chain.
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

    /// `getConstraintDeclaration`, `getResolvedTypeParameterDefault`: the first of all the
    /// declarations of the type parameter that has the requested `part`, or else its own
    /// declaration. Those with the same name in the declarations of a class or an interface are one
    /// type parameter: a result from another declaration is returned with the type parameters of
    /// that declaration and of this one.
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
        // `infer U` occurring twice is one type parameter.
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
            let Some(theirs) = decl.type_params_of_class_or_interface(other) else {
                continue;
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

    /// Rewrites a type that one declaration of a class or an interface expresses in `theirs`, its
    /// type parameters, in terms of `own`, those of another declaration: they correspond by name.
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
        let mapper = self.types().mapper(pairs);
        self.instantiate(ty, mapper)
    }

    /// `instantiateSignatureEx`, the mapper assigned to a cloned type parameter: the mappings of
    /// `around`, plus the clones for the type parameters declared in the same list as `tp`.
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
        let mapping = self.types().mapping(around);
        let mut pairs = Vec::with_capacity(mapping.len() + fresh.len());
        pairs.extend(
            mapping
                .iter()
                .copied()
                .filter(|p| !fresh.iter().any(|f| f.0 == p.0)),
        );
        pairs.extend_from_slice(&fresh);
        self.types().mapper(pairs)
    }

    /// `getInferredTypeParameterConstraint`: the constraint implied for `infer T` by its position.
    #[inline(never)]
    pub(super) fn inferred_type_param_constraint(
        &mut self,
        param: TypeId,
        file: FileId,
        tp: TypeParamId,
        omit_type_references: bool,
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
        if !omit_type_references {
            if let Some(known) = self.p.inferred_constraints.get(&self.task, &param) {
                return known;
            }
            if let Some(raw) = self.provisional(Query::InferredConstraint(param)) {
                return (raw != 0).then(|| TypeId(raw as u32 - 1));
            }
            if !self.enter(Query::InferredConstraint(param)) {
                return None;
            }
        }
        let mut inferences = Vec::new();
        for &decl in decls {
            let Decl::TypeParam(p) = decl else { continue };
            match position_of(p) {
                Some(InferPosition::TypeArgument(node, index)) if !omit_type_references => {
                    let hir = self.hir(file);
                    let TypeNodeKind::Ref { name, args } = hir[node].kind else {
                        continue;
                    };
                    let names: SmallVec<[Atom; 4]> = hir.texts(name).collect();
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
                    let sym = self.merged_symbol_of_class_or_interface(sym);
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
                    // `newDeferredTypeMapper`: the type arguments are not resolved unless the
                    // constraint references a type parameter.
                    let constraint = if self.has_type_variables(declared) {
                        let actual = self.types_from_nodes(file, args);
                        let filled = self.fill_type_args(&params, &actual);
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
                // `{ [K in X]: E } extends { [_ in Y]: infer T } ? ..`: `E`, with the constraint of
                // `K` substituted for `K`.
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
                Some(InferPosition::TypeArgument(..)) | None => {}
            }
        }
        let constraint = if inferences.is_empty() {
            None
        } else {
            Some(self.intersection(&inferences))
        };
        if !omit_type_references {
            match self.leave(Query::InferredConstraint(param)) {
                Ok(stored) => {
                    self.p
                        .inferred_constraints
                        .insert(&self.task, param, constraint, stored);
                }
                Err(open) => {
                    let raw = constraint.map_or(0, |ty| u64::from(ty.0) + 1);
                    self.cache_provisionally(Query::InferredConstraint(param), raw, open);
                }
            }
        }
        constraint
    }

    /// `getDefaultFromTypeParameter`
    pub fn default_of_type_param(&mut self, param: TypeId) -> Option<TypeId> {
        if let Some(kept) = self.p.type_param_defaults.get(&self.task, &param) {
            return kept;
        }
        let TypeData::TypeParam(file, tp, around) = *self.data(param) else {
            return None;
        };
        let (before, scope) = (self.non_cacheable_mark(), self.begin_scope());
        let default = self.resolve_default_of_type_param(file, tp, around);
        let ended = self.end_scope(scope);
        if self.non_cacheable_mark() == before
            && let Ok(stored) = ended
        {
            self.p
                .type_param_defaults
                .insert(&self.task, param, default, stored);
        }
        default
    }

    #[inline(never)]
    fn resolve_default_of_type_param(
        &mut self,
        file: FileId,
        tp: TypeParamId,
        around: MapperId,
    ) -> Option<TypeId> {
        // The default of a cloned type parameter is the declared default instantiated with the mapper of the clone.
        if around != MapperId::IDENTITY {
            let declared = self.type_param(file, tp);
            let default = self.default_of_type_param(declared)?;
            let mapper = self.clone_mapper(file, tp, around);
            return Some(self.instantiate(default, mapper));
        }
        let (of, written, lists) =
            self.type_param_declaration_with(file, tp, |p: &TypeParam| p.default);
        let node = self.hir(of)[written].default;
        if node.is_none() {
            return None;
        }
        let default = self.type_from_node(of, node);
        Some(match lists {
            Some((theirs, own)) => {
                self.in_terms_of_own_type_params(default, (of, theirs), (file, own))
            }
            None => default,
        })
    }

    /// The same for the type parameters of `sig`, whose defaults may reference those of the type it
    /// was found in.
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
                // The default of a cloned type parameter is already instantiated with them.
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
        let actual = args.len().min(params.len());
        let mut filled: Vec<TypeId> = Vec::with_capacity(params.len());
        filled.extend_from_slice(&args[..actual]);
        // Invalid forward references in default types are mapped to the error type.
        filled.resize(params.len(), TypeId::ERROR);
        for i in actual..params.len() {
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

    /// The type that `sym` denotes in a type position.
    #[inline]
    pub fn declared_type(&mut self, sym: Sym) -> TypeId {
        if let Some((known, _)) = self.p.declared_types.get(&self.task, &sym) {
            return known;
        }
        self.resolve_declared_type(sym)
    }

    #[inline(never)]
    fn resolve_declared_type(&mut self, sym: Sym) -> TypeId {
        loop {
            let ty = self.resolve_declared_type_once(sym);
            if self.unwind_to != self.stack.len() || !self.resolve_what_was_too_deep() {
                return ty;
            }
            if let Some((known, _)) = self.p.declared_types.get(&self.task, &sym) {
                return known;
            }
        }
    }

    /// Inlined: see `resolve_type_of_symbol_once`.
    #[inline(always)]
    fn resolve_declared_type_once(&mut self, sym: Sym) -> TypeId {
        if let Some(raw) = self.provisional(Query::Declared(sym)) {
            return TypeId(raw as u32);
        }
        if !self.enter(Query::Declared(sym)) {
            return if self.found_cycle {
                TypeId::ERROR
            } else {
                TypeId::UNRESOLVED
            };
        }
        let ty = self.declared_type_uncached(sym);
        let left = self.leave(Query::Declared(sym));
        // `getDeclaredTypeOfTypeAlias`: `popTypeResolution` fails.
        if self.left_a_cycle {
            let stored = self.cycle_result();
            if let Some((file, alias)) = self.alias_declaration(sym) {
                let start = self.hir(file)[alias].name_pos;
                let at = (file, start, self.end_of_token_at(file, start));
                let err = self.new_diagnostic(at, 2456, &[Arg::Sym(sym)]);
                self.add_diagnostic_of(Some(Query::Declared(sym)), err);
            }
            // The value of an inner evaluation above a `resolution_start` barrier stays, if one was stored. It gets the flag.
            let known = self.p.declared_types.get(&self.task, &sym);
            let ty = known.map_or(TypeId::ERROR, |(known, _)| known);
            return self
                .p
                .declared_types
                .rewrite(&self.task, sym, (ty, true), stored)
                .0;
        }
        match left {
            Ok(stored) => {
                self.p
                    .declared_types
                    .insert(&self.task, sym, (ty, false), stored);
            }
            Err(open) => self.cache_provisionally(Query::Declared(sym), u64::from(ty.0), open),
        }
        ty
    }

    /// `tryGetDeclaredTypeOfSymbol`
    fn declared_type_uncached(&mut self, sym: Sym) -> TypeId {
        let flags = self.files().flags(sym);
        if flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE) {
            // `getDeclaredTypeOfClassOrInterface`: a reference to itself whose type arguments are
            // its outer type parameters and its own.
            let outer = self.outer_type_params_of_symbol(sym);
            let local = self.local_type_params_of_symbol(sym);
            let args: SmallVec<[TypeId; 8]> = outer.iter().chain(local.iter()).copied().collect();
            return self.intern_key(TypeKey::Ref {
                target: sym,
                args: &args,
            });
        }
        if flags.contains(SymFlags::TYPE_ALIAS) {
            for (file, decl) in declarations_of(self.files(), sym) {
                if let Decl::Alias(a) = decl {
                    return self.type_from_node(file, self.hir(file)[a].ty);
                }
            }
        }
        if flags.intersects(SymFlags::ENUM) {
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
        // `getDeclaredTypeOfAlias`
        if flags.contains(SymFlags::ALIAS)
            && let Some(target) = self
                .files()
                .resolve_alias(sym)
                .filter(|&target| target != sym)
        {
            let target = self.merged_symbol_of_class_or_interface(target);
            return self.declared_type(target);
        }
        TypeId::UNRESOLVED
    }

    /// `getDeclaredTypeOfEnum`: the union of its member types. An enum without members gets a
    /// distinct type.
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
                    // `getEnumLiteralType`: members with the same value share one type, which is
                    // named after the first of them.
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
        let union = self.union(&members);
        if self.is_union(union) {
            self.with_alias(union, sym, &[])
        } else {
            union
        }
    }

    /// `getBaseTypeOfEnumLikeType`: the enum type that `member` belongs to.
    pub fn enum_type_of_member(&mut self, member: Sym) -> TypeId {
        let parent = self.files().symbol(member).parent;
        if parent.is_none() {
            return TypeId::NUMBER;
        }
        let parent = self.files().sym(member.file, parent);
        // A class, interface or alias declared under the same name takes precedence in
        // `declared_type`.
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
                // `getDeclaredTypeOfEnum` skips a member without a bindable name
                // (`hasBindableName`), which gets the type of the enum.
                if self.hir(file)[m].name.is_none() {
                    return self.enum_type_of_member(member);
                }
                // `createComputedEnumType`: a member without a value gets a distinct type.
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
        if let Some(known) = self.p.enum_values.get(&self.task, &(file, member)) {
            return known;
        }
        if !self.enter(Query::Enum(file, member)) {
            return Evaluated::default();
        }
        let value = self.compute_enum_member_value(file, member);
        if let Ok(stored) = self.leave(Query::Enum(file, member)) {
            self.p
                .enum_values
                .insert(&self.task, (file, member), value, stored);
        }
        value
    }

    /// `computeEnumMemberValue`. `autoValue` and `previous` are computed on demand, not passed in.
    fn compute_enum_member_value(&mut self, file: FileId, member: EnumMemberId) -> Evaluated {
        let hir = self.hir(file);
        let (name, pos) = (hir[member].name, hir[member].pos);
        let at = (file, pos, self.end_of_name_at(file, pos));
        // `IsComputedNonLiteralName`: `["a"]` and `[1]` are named by their literal, any other `[e]` has no name.
        if hir.text.get(pos as usize) == Some(&b'[') && (name.is_none() || name == known::empty) {
            self.error_at(at, 1164, &[]);
        } else if is_bigint_literal_at(hir, pos)
            || name.is_some()
                && self.is_numeric_name(name)
                && !matches!(
                    self.atoms().bytes(name),
                    b"Infinity" | b"-Infinity" | b"NaN"
                )
        {
            self.error_at(at, 2452, &[]);
        }
        if hir[member].init.is_some() {
            return self.compute_constant_enum_member_value(file, member);
        }
        let en = self.bound(file).enum_member_owner[member.idx()];
        if is_ambient_enum(hir, en) && !hir[en].flags.contains(Flags::CONST) {
            return Evaluated::default();
        }
        if hir[en].members.start == member.0 {
            return Evaluated::number(0.0);
        }
        let previous = EnumMemberId(member.0 - 1);
        let before = self.get_enum_member_value(file, previous);
        let Some(EnumValue::Number(bits)) = before.value else {
            self.error_at(at, 1061, &[]);
            return Evaluated::default();
        };
        if self.p.files.options.isolated_modules
            && hir[previous].init.is_some()
            && before.resolved_other_files
        {
            self.error_at(at, 18056, &[]);
        }
        Evaluated::number(f64::from_bits(bits) + 1.0)
    }

    /// `computeConstantEnumMemberValue`
    fn compute_constant_enum_member_value(
        &mut self,
        file: FileId,
        member: EnumMemberId,
    ) -> Evaluated {
        let hir = self.hir(file);
        let en = self.bound(file).enum_member_owner[member.idx()];
        let is_const = hir[en].flags.contains(Flags::CONST);
        let initializer = hir[member].init;
        let result = self.evaluate(file, initializer, Location::Member(file, member));
        // The parser has reported it.
        if matches!(hir[initializer].kind, ExprKind::Missing) {
            return result;
        }
        let at = self.span_of_parenthesized_expr(file, initializer);
        match result.value {
            Some(value) => {
                if is_const
                    && let EnumValue::Number(n) = value
                    && !f64::from_bits(n).is_finite()
                {
                    let is_nan = f64::from_bits(n).is_nan();
                    self.error_at(at, if is_nan { 2478 } else { 2477 }, &[]);
                }
                if self.p.files.options.isolated_modules
                    && matches!(value, EnumValue::String(_))
                    && !result.is_syntactically_string
                {
                    let atoms = self.atoms();
                    let name = cat!(
                        atoms.bytes(hir[en].name),
                        b".",
                        atoms.bytes(hir[member].name)
                    );
                    self.error_at(at, 18055, &[Arg::Bytes(&name)]);
                }
            }
            None if is_const => {
                self.error_at(at, 2474, &[]);
            }
            None if is_ambient_enum(hir, en) => {
                self.error_at(at, 1066, &[]);
            }
            None => {
                let ty = self.type_of_expr(file, initializer);
                self.check_type_assignable_to(ty, TypeId::NUMBER, Some(at), Some(18033));
            }
        }
        result
    }

    /// `evaluate(e, e)`: the value `e` evaluates to, if it consists only of literals, enum members
    /// and constants that themselves do.
    pub(super) fn constant_value(&mut self, file: FileId, e: ExprId) -> Option<EnumValue> {
        self.evaluate(file, e, Location::Expr(file, e)).value
    }

    fn constant_text(&self, value: EnumValue) -> &'p [u8] {
        let atom = match value {
            EnumValue::String(s) => s,
            EnumValue::Number(bits) => self.number_name(f64::from_bits(bits)),
        };
        self.atoms().bytes(atom)
    }

    /// `isConstantVariable(symbol)` and the conditions `evaluateEntity` checks on its
    /// `ValueDeclaration`: a constant declared by an identifier, whose type is inferred from its
    /// initializer, declared before `location`.
    pub(super) fn constant_variable_declaration(
        &mut self,
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

    /// `resolveEntityName(e, meaning, ignoreErrors)` for `e` with its enclosing parentheses
    /// stripped: every name but the last resolves as a namespace. Also `None` if that is not an
    /// `IsEntityNameExpression`, as `(a).b` is not.
    pub(super) fn resolve_entity_name_expression(
        &self,
        file: FileId,
        e: ExprId,
        meaning: SymFlags,
    ) -> Option<Sym> {
        let hir = self.hir(file);
        let found = match hir[e].kind {
            // `resolveName(e, name, meaning)`. The binder has already resolved the value meaning of
            // an identifier.
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
        let mut sym = self.files().resolve_alias_as(found, meaning)?;
        // See `AliasSymbolLinks::immediate_target`.
        if meaning == SymFlags::VALUE {
            sym = self.files().canonical(sym);
        }
        self.files().flags(sym).intersects(meaning).then_some(sym)
    }

    // ───────────────────────────── type syntax ─────────────────────────────

    pub fn types_from_nodes(&mut self, file: FileId, nodes: IdList<TypeNodeId>) -> Vec<TypeId> {
        let hir = self.hir(file);
        hir.ids(nodes)
            .map(|n| self.type_from_node(file, n))
            .collect()
    }

    /// The type `node` denotes, with the type parameters in scope left uninstantiated.
    #[inline]
    pub fn type_from_node(&mut self, file: FileId, node: TypeNodeId) -> TypeId {
        if node.is_none() {
            return TypeId::UNRESOLVED;
        }
        if let Some(known) = self.p.type_node_types.get(&self.task, &(file, node)) {
            return known;
        }
        self.resolve_type_from_node(file, node)
    }

    #[inline(never)]
    fn resolve_type_from_node(&mut self, file: FileId, node: TypeNodeId) -> TypeId {
        if let Some(raw) = self.provisional(Query::TypeNode(file, node)) {
            return TypeId(raw as u32);
        }
        if !self.enter(Query::TypeNode(file, node)) {
            // `getTypeFromTypeNode` does not detect re-entry: tsgo recurses until it hits an instantiation limit.
            return self.excessively_deep();
        }
        let ty = self.type_from_node_uncached(file, node);
        let ty = self.conditional_flow_type_of_type(file, ty, node);
        let ty = self.with_alias_for_type_node(file, node, ty);
        match self.leave(Query::TypeNode(file, node)) {
            // Where the node was in progress several times, the outermost is the last to store.
            Ok(stored) => {
                self.p
                    .type_node_types
                    .rewrite(&self.task, (file, node), ty, stored);
            }
            Err(open) => {
                self.cache_provisionally(Query::TypeNode(file, node), u64::from(ty.0), open);
            }
        }
        ty
    }

    /// `getTypeFromArrayOrTupleTypeNode`. `readonly`: `isReadonlyTypeOperator(node.Parent)`.
    fn array_or_tuple_type_from_node(
        &mut self,
        file: FileId,
        scope: ScopeId,
        node: TypeNodeId,
        readonly: bool,
    ) -> TypeId {
        let hir = self.hir(file);
        // A tuple type with a variadic element is never deferred, and `[]` is its target.
        let may_be_deferred = match hir[node].kind {
            TypeNodeKind::Tuple(elems) => {
                !elems.is_empty()
                    && !elems
                        .iter()
                        .any(|e| is_variadic_tuple_element(hir, &hir[e]))
            }
            _ => true,
        };
        if may_be_deferred && self.is_deferred_type_reference_node(file, scope, node, false) {
            // `getArrayOrTupleTargetType`
            let array = if readonly {
                known::ReadonlyArray
            } else {
                known::Array
            };
            let arguments = self.deferred_type_arguments_of_node(file, scope, node);
            let target = match hir[node].kind {
                TypeNodeKind::Tuple(elems) if array_element_type_node(hir, node).is_none() => {
                    Some(TypeData::Tuple {
                        elems: arguments,
                        flags: self.list_of(elems.iter().map(|e| tuple_element_info(hir, &hir[e]))),
                        readonly,
                    })
                }
                // `target == c.emptyGenericType`: there is no global `Array`.
                _ => self.global_type_symbol(array).map(|target| TypeData::Ref {
                    target,
                    args: arguments,
                }),
            };
            if let Some(target) = target {
                return self.deferred_type_reference_of_node(file, scope, node, target);
            }
        }
        // `ObjectFlagsFromTypeNode`
        let first_new_type_id = self.types().first_new_type_id();
        let ty = match hir[node].kind {
            TypeNodeKind::Array(element) => {
                let element = self.type_from_node(file, element);
                if readonly {
                    self.readonly_array_of(element)
                } else {
                    self.array_of(element)
                }
            }
            TypeNodeKind::Tuple(elems) => {
                let mut types = self.tuple_element_types_from_nodes(file, elems);
                let mut flags: Vec<ElemFlags> = elems
                    .iter()
                    .map(|e| tuple_element_info(hir, &hir[e]))
                    .collect();
                // `X` in `...X` may resolve to an array type regardless of its syntax.
                for (ty, flag) in types.iter_mut().zip(&mut flags) {
                    if flag.contains(ElemFlags::VARIADIC)
                        && let Some(element) = self.array_element(*ty)
                    {
                        (*ty, *flag) = (element, ElemFlags::REST.with_label(flag.label()));
                    }
                }
                self.normalized_tuple(&types, &flags, readonly)
            }
            _ => TypeId::ERROR,
        };
        self.types().mark_from_type_node(ty, first_new_type_id);
        ty
    }

    /// `node` and `mapper` of `createDeferredTypeReference(target, node, nil, nil)`
    fn deferred_type_arguments_of_node(
        &mut self,
        file: FileId,
        scope: ScopeId,
        node: TypeNodeId,
    ) -> TypeArguments<'s> {
        let mapper = self.identity_mapper_for_node(file, scope, node);
        TypeArguments::deferred_in(file, node, mapper, self.arena)
    }

    /// `createDeferredTypeReference(target, node, nil, nil)`. `reference`: the same reference with
    /// the result of `deferred_type_arguments_of_node`.
    fn deferred_type_reference_of_node(
        &mut self,
        file: FileId,
        scope: ScopeId,
        node: TypeNodeId,
        reference: TypeData<'s>,
    ) -> TypeId {
        let alias = self.alias_for_type_node(file, scope, node);
        let alias = alias
            .as_ref()
            .map(|(alias, type_arguments)| (*alias, &type_arguments[..]));
        let first_new_type_id = self.types().first_new_type_id();
        let ty = self.deferred_type_reference(reference, alias);
        self.types().mark_from_type_node(ty, first_new_type_id);
        ty
    }

    /// `core.Map(node.Elements(), c.getTypeFromTypeNode)` for a tuple type node.
    fn tuple_element_types_from_nodes(
        &mut self,
        file: FileId,
        elems: Span<TupleElemId>,
    ) -> Vec<TypeId> {
        let hir = self.hir(file);
        (elems.iter())
            .map(|e| self.type_from_tuple_element(file, hir[e]))
            .collect()
    }

    fn type_from_node_uncached(&mut self, file: FileId, node: TypeNodeId) -> TypeId {
        let hir = self.hir(file);
        let scope = self.bound(file).type_scope[node.idx()];
        match hir[node].kind {
            TypeNodeKind::Error | TypeNodeKind::Heritage(_) => TypeId::UNRESOLVED,
            TypeNodeKind::Keyword(k) => match k {
                Keyword::Any => TypeId::ANY,
                Keyword::Unknown => TypeId::UNKNOWN,
                Keyword::Never => TypeId::NEVER,
                Keyword::Void => TypeId::VOID,
                // `undefinedType`, `nullType`: as type nodes they are never widened.
                Keyword::Undefined => TypeId::UNDEFINED,
                Keyword::Null => TypeId::NULL,
                Keyword::String => TypeId::STRING,
                Keyword::Number => TypeId::NUMBER,
                Keyword::Boolean => TypeId::BOOLEAN,
                Keyword::BigInt => TypeId::BIGINT,
                Keyword::Symbol => TypeId::SYMBOL,
                Keyword::Object => TypeId::OBJECT,
                Keyword::Intrinsic => TypeId::INTRINSIC_MARKER,
                Keyword::This => {
                    let this = self.this_type_at(file, node, scope);
                    if this == TypeId::ERROR {
                        self.error_at(self.place_of_token(file, hir[node].pos), 2526, &[]);
                    }
                    this
                }
            },
            TypeNodeKind::StringLit(value) => self.string_literal(value, false),
            TypeNodeKind::NumberLit(n) => self.number_literal(hir.numbers[n as usize], false),
            TypeNodeKind::BigIntLit { text, negative } => {
                // `NewPseudoBigInt`: zero has no sign.
                let digits = self.atoms().bytes(text);
                let negative = negative && !digits.iter().all(|&c| c == b'0' || c == b'n');
                self.intern(TypeData::BigIntLit {
                    text,
                    negative,
                    fresh: false,
                })
            }
            TypeNodeKind::BoolLit(value) => self.bool_literal(value, false),
            TypeNodeKind::UniqueSymbol => TypeId::SYMBOL,
            TypeNodeKind::JSDoc { ty, kind, .. } => {
                let of = self.type_from_node(file, ty);
                match kind {
                    // `getNullableType(t, TypeFlagsNull)`
                    JSDocTypeKind::Nullable => self.union(&[of, TypeId::NULL]),
                    JSDocTypeKind::NonNullable => of,
                    // `addOptionality`
                    JSDocTypeKind::Optional => self.union(&[of, TypeId::UNDEFINED]),
                    // `createArrayType`
                    JSDocTypeKind::Variadic => self.array_of(of),
                }
            }
            TypeNodeKind::Array(_) | TypeNodeKind::Tuple(_) => {
                self.array_or_tuple_type_from_node(file, scope, node, false)
            }
            // `getTypeFromTypeOperatorNode`: `c.getTypeFromTypeNode(node.Type())`, which asks `isReadonlyTypeOperator(node.Parent)`.
            TypeNodeKind::Readonly(operand) => {
                // `readonly` only applies to an array or tuple type that directly follows it. Parentheses have no node, so the
                // position check below rejects `readonly (T[])`.
                if operand.is_none()
                    || !matches!(
                        hir[operand].kind,
                        TypeNodeKind::Array(_) | TypeNodeKind::Tuple(_)
                    )
                    || !hir.text.is_empty()
                        && self.skip_trivia_from(file, hir[node].pos + b"readonly".len() as u32)
                            != hir[operand].pos
                {
                    return self.type_from_node(file, operand);
                }
                let scope = self.bound(file).type_scope[operand.idx()];
                self.array_or_tuple_type_from_node(file, scope, operand, true)
            }
            TypeNodeKind::Union(members) => {
                let members = self.types_from_nodes(file, members);
                self.union(&members)
            }
            TypeNodeKind::Intersection(nodes) => {
                let members = self.types_from_nodes(file, nodes);
                // `getTypeFromIntersectionTypeNode`: `string & {}` is not reduced, so that `"a" |
                // "b" | (string & {})` preserves its literals. The same applies to `number`,
                // `bigint` and a non-generic template literal type.
                // `types.indexOf(emptyTypeLiteralType)` compares by type identity, so `string &
                // NonNullable<unknown>` qualifies and `string & E` with `type E = {}` does not.
                if let [a, b] = members[..]
                    && let Some(empty) = members.iter().position(|&m| m == TypeId::EMPTY_OBJECT)
                {
                    let other = members[1 - empty];
                    if matches!(other, TypeId::STRING | TypeId::NUMBER | TypeId::BIGINT)
                        || matches!(self.data(other), TypeData::Template { .. })
                            && self.is_pattern_literal(other)
                    {
                        let ty = self.intern_key(TypeKey::Intersection(&[a, b]));
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
                self.intern_key(TypeKey::Fns {
                    decls: &[(file, func)],
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
                // `getTypeFromMappedTypeNode`: the constraint of the key is resolved eagerly,
                // through its base constraint (`hasNonCircularBaseConstraint`), which detects a
                // cycle through a type alias.
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
                let alias = self.alias_for_type_node(file, scope, node);
                let alias = alias
                    .as_ref()
                    .map(|(alias, type_arguments)| (*alias, &type_arguments[..]));
                let ty = self
                    .indexed_access_of_type_node(obj, index, (file, node), alias)
                    .unwrap_or(TypeId::ERROR);
                // `getPropertyTypeForIndexType`: in the indexed access type `T["p"]`, the missing
                // type becomes `undefined`.
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
            TypeNodeKind::Typeof {
                name,
                args,
                has_type_arguments,
                expr,
            } => {
                // `getTypeFromTypeQueryNode`: `getRegularTypeOfLiteralType(getWidenedType(t))`
                let narrowed = self.type_of_expr(file, expr);
                let narrowed = self.get_widened_type(narrowed);
                // `checkPropertyAccessExpressionOrQualifiedName`: the missing name of `typeof a.`
                // resolves to no property, so the result is the error type.
                if narrowed == TypeId::UNRESOLVED
                    && hir.texts(name).next_back() == Some(known::empty)
                {
                    return TypeId::ERROR;
                }
                let ty = if narrowed == TypeId::UNRESOLVED {
                    let names: SmallVec<[Atom; 4]> = hir.texts(name).collect();
                    self.type_of_entity_at(file, scope, &names, expr)
                } else {
                    self.regular(narrowed)
                };
                // `getInstantiationExpressionType`: `typeArguments == nil`
                if !has_type_arguments {
                    return ty;
                }
                let args = self.types_from_nodes(file, args);
                self.with_type_arguments(ty, &args, InstantiationExpression::TypeNode(file, node))
            }
            TypeNodeKind::Import { .. } => self.get_type_from_import_type_node(file, scope, node),
            TypeNodeKind::Ref { name, args } => {
                if let Some(intended) = self.get_intended_type_from_jsdoc_type_reference(file, node)
                {
                    return intended;
                }
                let names: SmallVec<[Atom; 4]> = hir.texts(name).collect();
                // `resolveTypeReferenceName`: `getUnresolvedSymbolForEntityName`
                // `NameResolver.Resolve`: for `const` the walk ends without an error at an `as const`.
                let is_const_assertion = |n| matches!(hir.data(n), NodeData::Expr(e) if matches!(hir[e].kind, ExprKind::AsConst(_)));
                let ignore_errors = self.bound(file).is_unchecked_type(node.idx())
                    || names.first() == Some(&known::r#const)
                        && (hir.find_ancestor(hir.node(node), is_const_assertion)).is_some();
                let Some(sym) = self.resolve_type_reference_name(file, scope, name, ignore_errors)
                else {
                    let args = self.types_from_nodes(file, args);
                    return self.unresolved_name_type(&names, &args);
                };
                self.type_reference_type_of_node(file, scope, node, sym, args)
            }
        }
    }

    /// `getTypeFromImportTypeNode`
    fn get_type_from_import_type_node(
        &mut self,
        file: FileId,
        scope: ScopeId,
        node: TypeNodeId,
    ) -> TypeId {
        let TypeNodeKind::Import {
            args, is_typeof, ..
        } = self.hir(file)[node].kind
        else {
            return TypeId::ERROR;
        };
        let reports_errors = !self.bound(file).is_unchecked_type(node.idx());
        let Some(symbol) = self.resolve_import_type(file, node, reports_errors) else {
            return TypeId::ERROR;
        };
        // `resolveImportSymbolType`
        if is_typeof {
            let ty = self.type_of_alias_target(symbol);
            // `getInstantiationExpressionType`: `typeArguments == nil`
            if args.is_empty() {
                return ty;
            }
            let args = self.types_from_nodes(file, args);
            let node = InstantiationExpression::TypeNode(file, node);
            return self.with_type_arguments(ty, &args, node);
        }
        let AliasTarget::Symbol(sym) = self.resolve_symbol(symbol) else {
            return TypeId::ERROR;
        };
        // `resolveSymbol` only follows a non-local alias. An `export =` symbol that is also a namespace is returned unchanged:
        // `getDeclaredTypeOfAlias`.
        let flags = self.files().flags(sym);
        if flags.contains(SymFlags::ALIAS) && !flags.intersects(SymFlags::TYPE) {
            let Some(target) = self.files().resolve_alias(sym) else {
                return TypeId::ERROR;
            };
            // `checkNoTypeArguments`
            if !args.is_empty() || !self.files().flags(target).intersects(SymFlags::TYPE) {
                return TypeId::ERROR;
            }
            let target = self.merged_symbol_of_class_or_interface(target);
            let ty = self.declared_type(target);
            return self.regular(ty);
        }
        // `getTypeReferenceType`
        if !flags.intersects(SymFlags::TYPE) {
            return TypeId::ERROR;
        }
        self.type_reference_type_of_node(file, scope, node, sym, args)
    }

    /// The qualifier loop of `getTypeFromImportTypeNode`. Returns the final `currentNamespace` (the module symbol if there is no qualifier),
    /// or `None` where tsgo returns `errorType`.
    pub(super) fn resolve_import_type(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        reports_errors: bool,
    ) -> Option<AliasTarget> {
        let (hir, files) = (self.hir(file), self.files());
        let TypeNodeKind::Import {
            spec,
            name,
            is_typeof,
            mode,
            ..
        } = hir[node].kind
        else {
            return None;
        };
        let target_meaning = if is_typeof {
            SymFlags::VALUE
        } else {
            SymFlags::TYPE
        };
        let mode = files.mode_of_import(file, mode);
        let inner_module_symbol = files.module_of_specifier_as(file, spec, mode)?;
        // `resolveExternalModuleSymbol`
        let module_symbol = self.resolve_symbol(files.module_value(inner_module_symbol));
        if name.is_empty() {
            let flags = match module_symbol {
                AliasTarget::Symbol(symbol) => self.get_symbol_flags(symbol),
                _ => SymFlags::PROPERTY,
            };
            if !flags.intersects(target_meaning) {
                if reports_errors {
                    let code = if is_typeof { 1339 } else { 1340 };
                    self.error(file, node, code, &[Arg::Atom(spec)]);
                }
                return None;
            }
        }
        let mut current_namespace = module_symbol;
        for (i, current) in name.iter().enumerate() {
            let text = hir[current].text;
            let meaning = if is_typeof || i + 1 == name.len() {
                target_meaning
            } else {
                SymFlags::NAMESPACE
            };
            let merged_resolved_symbol = self.resolve_symbol(current_namespace);
            // `includeTypeOnlyMembers`: the object type of a module or namespace omits type-only exports, so look in the export table first.
            let exported = (merged_resolved_symbol.symbol())
                .and_then(|symbol| files.namespace_member(symbol, text));
            let mut next = self.get_symbol(exported, meaning).map(AliasTarget::Symbol);
            if next.is_none() && is_typeof {
                let ty = self.type_of_alias_target(merged_resolved_symbol);
                if let Some((prop, mapper)) = self.get_property_of_type(ty, text) {
                    next = Some(AliasTarget::Property(
                        ty,
                        text,
                        self.type_of_prop(prop, mapper),
                    ));
                }
            }
            let Some(next) = next else {
                if reports_errors {
                    let namespace = fully_qualified_name_of(self, current_namespace);
                    self.error(
                        file,
                        current,
                        2694,
                        &[Arg::Bytes(&namespace), Arg::Atom(text)],
                    );
                }
                return None;
            };
            current_namespace = next;
        }
        Some(current_namespace)
    }

    /// `resolveTypeReferenceName`
    pub(super) fn resolve_type_reference_name(
        &mut self,
        file: FileId,
        scope: ScopeId,
        name: Span<NameId>,
        ignore_errors: bool,
    ) -> Option<Sym> {
        let found = self.resolve_entity_name(file, scope, name, SymFlags::TYPE, ignore_errors)?;
        // `resolveEntityName` resolves an alias to the first symbol in the chain that has a type meaning.
        let target = match self.combined_symbol_of_alias(found) {
            Some(combined) => combined,
            None => self.files().resolve_alias_as(found, SymFlags::TYPE)?,
        };
        // `getSymbol` only returns a symbol that has the requested meaning.
        self.files()
            .flags(target)
            .intersects(SymFlags::TYPE)
            .then(|| self.merged_symbol_of_class_or_interface(target))
    }

    /// `getMergedSymbol(symbol)` of `getTypeFromClassOrInterfaceReference`, for a symbol that
    /// `resolveEntityName` returns. `resolveAlias` leaves it as the table of its module has it
    /// (`AliasSymbolLinks::alias_target`), and `getTypeReferenceType` takes the declared type of an
    /// enum from that.
    fn merged_symbol_of_class_or_interface(&self, symbol: Sym) -> Sym {
        let files = self.files();
        let merges = SymFlags::CLASS | SymFlags::INTERFACE;
        match files.flags(symbol).intersects(merges) {
            true => files.canonical(symbol),
            false => symbol,
        }
    }

    /// `getTypeReferenceType` for the type reference node `node`, which names `sym` and has the type argument nodes `args`.
    fn type_reference_type_of_node(
        &mut self,
        file: FileId,
        scope: ScopeId,
        node: TypeNodeId,
        sym: Sym,
        args: IdList<TypeNodeId>,
    ) -> TypeId {
        let hir = self.hir(file);
        let flags = self.files().flags(sym);
        let is_class_or_interface = flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE);
        let Some(most) = self.check_type_argument_count(sym, args.len(), file, Ok(node)) else {
            return TypeId::ERROR;
        };
        if is_class_or_interface
            && most != 0
            && matches!(hir[node].kind, TypeNodeKind::Ref { .. })
            && self.is_deferred_type_reference_node(file, scope, node, args.len() != most)
        {
            let reference = TypeData::Ref {
                target: sym,
                args: self.deferred_type_arguments_of_node(file, scope, node),
            };
            return self.deferred_type_reference_of_node(file, scope, node, reference);
        }
        let mut args = self.types_from_nodes(file, args);
        // In a JavaScript file a generic class or interface accepts any number of type arguments.
        if hir.is_js && is_class_or_interface && most != 0 {
            let params = self.local_type_params_of_symbol(sym);
            args = self.fill_type_args_as(&params, &args, true);
        }
        if most != 0 && !is_class_or_interface && flags.contains(SymFlags::TYPE_ALIAS) {
            self.type_from_type_alias_reference(file, node, sym, &args)
        } else {
            self.type_reference_of_node(sym, &args)
        }
    }

    /// The type argument count checks of `getTypeFromClassOrInterfaceReference`,
    /// `getTypeFromTypeAliasReference` and `checkNoTypeArguments`. Returns the number of type
    /// parameters of `sym`. `None`: `actual` is not a valid number of type arguments, and the
    /// reference is the error type.
    /// `node`: the reference, or the class in `file` whose `extends` clause has it.
    pub(super) fn check_type_argument_count(
        &mut self,
        sym: Sym,
        actual: usize,
        file: FileId,
        node: Result<TypeNodeId, ClassId>,
    ) -> Option<usize> {
        let flags = self.files().flags(sym);
        let is_class_or_interface = flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE);
        // `getDeclaredTypeOfTypeAlias`: a circular alias (2456) never gets its type parameters.
        let is_cycle = !is_class_or_interface && flags.contains(SymFlags::TYPE_ALIAS) && {
            self.declared_type(sym);
            let declared = self.p.declared_types.get(&self.task, &sym);
            declared.is_some_and(|(_, is_circular)| is_circular)
        };
        let (least, most) = if is_cycle {
            (0, 0)
        } else {
            self.type_argument_arity(sym)
        };
        if (least..=most).contains(&actual) {
            return Some(most);
        }
        let hir = self.hir(file);
        let is_js = hir.is_js && is_class_or_interface && most != 0;
        // `isJsImplicitAny`
        if is_js && !self.p.files.options.no_implicit_any {
            return Some(most);
        }
        let at = match node {
            Ok(node) => (file, hir[node].pos, self.end_of_type_node(file, node)),
            // Type arguments from an `@extends` tag are located elsewhere in the source.
            Err(class) => {
                let start = self.start_of(file, hir[class].extends);
                let end = super::errors::end_of_extends(self, file, &hir[class]);
                (
                    file,
                    start,
                    end.max(self.end_of_expr(file, hir[class].extends)),
                )
            }
        };
        if most == 0 {
            self.error_at(at, 2315, &[Arg::Sym(sym)]);
            return None;
        }
        // `missingAugmentsTag`, `IsExpressionWithTypeArguments`
        let is_heritage_element = is_js
            && match node {
                Ok(node) => {
                    let mut lists = hir.classes.iter().map(|c| c.implements);
                    lists.any(|list| hir.ids(list).any(|t| t == node))
                        || hir
                            .interfaces
                            .iter()
                            .any(|x| hir.ids(x.extends).any(|t| t == node))
                }
                Err(_) => true,
            };
        let code = match (least == most, is_heritage_element) {
            (true, false) => 2314,
            (false, false) => 2707,
            (true, true) => 8026,
            (false, true) => 8027,
        };
        let name = if is_class_or_interface {
            let declared = self.declared_type(sym);
            // `TypeFormatFlagsWriteArrayAsGenericType`
            match self.array_element(declared) {
                Some(element) => {
                    cat!(
                        self.symbol_to_string(sym),
                        b"<",
                        self.type_to_string(element),
                        b">"
                    )
                }
                None => self.type_to_string(declared),
            }
        } else {
            self.symbol_to_string(sym)
        };
        self.error_at(
            at,
            code,
            &[Arg::Bytes(&name), Arg::Number(least), Arg::Number(most)],
        );
        is_js.then_some(most)
    }

    /// `getIntendedTypeFromJSDocTypeReference`
    pub(super) fn get_intended_type_from_jsdoc_type_reference(
        &mut self,
        file: FileId,
        node: TypeNodeId,
    ) -> Option<TypeId> {
        let hir = self.hir(file);
        let TypeNodeKind::Ref { name, args } = hir[node].kind else {
            return None;
        };
        if name.len() != 1 || !hir.is_in_jsdoc(hir[node].pos) {
            return None;
        }
        let name = hir[name.at(0)].text;
        let no_implicit_any = self.p.files.options.no_implicit_any;
        let ty = match self.atoms().bytes(name) {
            b"String" => TypeId::STRING,
            b"Number" => TypeId::NUMBER,
            b"BigInt" => TypeId::BIGINT,
            b"Boolean" => TypeId::BOOLEAN,
            b"Void" => TypeId::VOID,
            b"Undefined" => TypeId::UNDEFINED,
            b"Null" => TypeId::NULL,
            b"Function" | b"function" => self.global_ref(known::Function, &[]),
            b"array" if args.is_empty() && !no_implicit_any => {
                return Some(self.array_of(TypeId::ANY));
            }
            b"promise" if args.is_empty() && !no_implicit_any => {
                return Some(self.promise_of(TypeId::ANY));
            }
            b"Object" if args.len() == 2 => {
                if let Some(record) = self.global_type_symbol(known::Record) {
                    let key = self.type_from_node(file, hir.id_at(args, 0));
                    if self.is_valid_index_key_type(key) {
                        let value = self.type_from_node(file, hir.id_at(args, 1));
                        return Some(self.type_reference_of_node(record, &[key, value]));
                    }
                }
                return Some(TypeId::ANY);
            }
            b"Object" if !no_implicit_any => TypeId::ANY,
            _ => return None,
        };
        // `checkNoTypeArguments`
        if !args.is_empty() {
            let at = (file, hir[node].pos, self.end_of_type_node(file, node));
            self.error_at(at, 2315, &[Arg::Atom(name)]);
        }
        Some(ty)
    }

    /// The first type alias declaration of `sym`.
    fn alias_declaration(&self, sym: Sym) -> Option<(FileId, AliasId)> {
        declarations_of(self.files(), sym).find_map(|(file, decl)| match decl {
            Decl::Alias(alias) => Some((file, alias)),
            _ => None,
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

    /// `getThisType`: the `this` type node `node` in `scope`. Where no `this` type is available an
    /// error is reported and the result is the error type.
    pub(super) fn this_type_at(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mut scope: ScopeId,
    ) -> TypeId {
        use crate::bind::{FnOwner, MemberOwner};
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `GetThisContainer`: the walk stops at a member of a type literal.
        if bound.this_in_type_literal.contains(&node) {
            return TypeId::ERROR;
        }
        let pos = hir[node].pos;
        // A type in a JSDoc comment precedes its host in the text, so the positions that the walk
        // below compares are not those of the tree.
        if hir.is_in_jsdoc(pos) {
            let this = hir.node(node);
            let container = hir.get_this_container(this, false, false);
            let class = hir.class_of(hir.parent(container));
            if class.is_none()
                || hir.is_static(container)
                || hir.kind(container) == Kind::Constructor
                    && hir
                        .find_ancestor(this, |n| n == hir.body(container))
                        .is_none()
            {
                return TypeId::ERROR;
            }
            let sym = self.class_sym(file, class);
            return self.intern(TypeData::ThisParam(sym));
        }
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            match s.kind {
                ScopeKind::Fn(f) => match hir[f].kind {
                    FnKind::Arrow | FnKind::FunctionType | FnKind::ConstructorType => {}
                    FnKind::Decl | FnKind::Expr | FnKind::StaticBlock => return TypeId::ERROR,
                    kind => {
                        // A method or an accessor of an object literal is not a member.
                        let FnOwner::Member(m) = bound.fns[f.idx()].owner else {
                            return TypeId::ERROR;
                        };
                        // For a constructor only the body qualifies. Its parameters and body share
                        // one scope.
                        let is_in_body = matches!(hir[f].body, FnBody::Block(body) if hir.ids(body).next().is_some_and(|first| hir[first].start <= pos));
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
                // Not inside a method body: in a property declaration, or else in the class head or in a method name, which
                // belong to the enclosing scope.
                ScopeKind::Class(c) => {
                    if let Some(m) = hir[c].members.iter().rev().find(|&m| hir[m].start <= pos)
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
                    if hir[i].members.iter().any(|m| hir[m].start <= pos) {
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

    /// The `this` type of the class or interface enclosing `scope`.
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

    /// `getTypeFromTypeAliasReference` for the generic alias `sym`, after the type argument count
    /// check. `args`: the type arguments at `node`.
    fn type_from_type_alias_reference(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        sym: Sym,
        args: &[TypeId],
    ) -> TypeId {
        let scope = self.bound(file).type_scope[node.idx()];
        let new_alias = match self.alias_for_type_node(file, scope, node) {
            // An alias declared in a function does not host a reference to a top-level alias.
            Some(alias) if self.is_local_type_alias(sym) || !self.is_local_type_alias(alias.0) => {
                Some(alias)
            }
            // "refers to an alias import/export/reexport"
            _ => self
                .resolve_type_reference_name_as_alias(file, scope, node)
                .and_then(|alias| self.resolve_alias(alias).symbol())
                .filter(|&resolved| self.files().flags(resolved).contains(SymFlags::TYPE_ALIAS))
                .map(|resolved| (resolved, SmallVec::from_slice(args))),
        };
        let new_alias = new_alias
            .as_ref()
            .map(|(alias, type_arguments)| (*alias, &type_arguments[..]));
        self.type_reference_type(sym, args, new_alias)
    }

    /// `resolveTypeReferenceName(node, SymbolFlagsAlias, ignoreErrors)`, if
    /// `IsTypeReferenceType(node)`. It is `Resolve` with `isUse`: the symbol found is marked as
    /// referenced, whatever it aliases.
    fn resolve_type_reference_name_as_alias(
        &self,
        file: FileId,
        scope: ScopeId,
        node: TypeNodeId,
    ) -> Option<Sym> {
        let hir = self.hir(file);
        let TypeNodeKind::Ref { name, .. } = hir[node].kind else {
            return None;
        };
        let names: SmallVec<[Atom; 4]> = hir.texts(name).collect();
        let files = self.files();
        let alias = files.resolve_entity(file, scope, &names, SymFlags::ALIAS)?;
        // In `a.b` the first name is resolved as a namespace, as it was before.
        if names.len() == 1 {
            // Written to the same buffer as `type_node_types[(file, node)]`, so both are published
            // at the same barrier: a task that hits that entry sees the mark, and a task that
            // misses it reaches this code itself.
            for &part in files.parts(alias).iter() {
                (self.p.symbol_reference_links).insert(&self.task, part, (), Stored::new());
            }
        }
        Some(alias)
    }

    /// `type_reference` for a type reference node.
    fn type_reference_of_node(&mut self, sym: Sym, args: &[TypeId]) -> TypeId {
        if !self
            .files()
            .flags(sym)
            .intersects(SymFlags::CLASS | SymFlags::INTERFACE)
        {
            return self.type_reference(sym, args);
        }
        // `getTypeFromClassOrInterfaceReference` passes `ObjectFlagsFromTypeNode`. The declared type is resolved first, so it is not
        // the type created here. The target of an alias reference is created by instantiation and gets no flag.
        self.declared_type(sym);
        let first_new_type_id = self.types().first_new_type_id();
        let ty = self.type_reference(sym, args);
        self.types().mark_from_type_node(ty, first_new_type_id);
        ty
    }

    /// `isDeferredTypeReferenceNode` for `node` in `scope`: an array type, a tuple type or a
    /// reference to a generic class or interface.
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
                let names: SmallVec<[Atom; 4]> = hir.texts(name).collect();
                let scope = self.bound(file).type_scope[node.idx()];
                let found = self
                    .files()
                    .resolve_entity(file, scope, &names, SymFlags::TYPE);
                found
                    .and_then(|found| self.files().resolve_alias_as(found, SymFlags::TYPE))
                    .is_some_and(|sym| self.files().flags(sym).contains(SymFlags::TYPE_ALIAS))
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

    /// `createDeferredTypeReference`. `reference`: the target with the node and the mapper.
    pub(super) fn deferred_type_reference(
        &self,
        reference: TypeData<'s>,
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        match alias {
            Some((alias, type_arguments)) => self.types().intern_with(
                reference,
                Provenance {
                    alias: Some((alias, self.list(type_arguments))),
                    ..Provenance::default()
                },
            ),
            None => self.intern(reference),
        }
    }

    /// `typeArguments` in `getTypeArguments`: the type arguments resolved from `node`, the node of
    /// the deferred type reference `ty`, before `d.mapper` is applied.
    pub(super) fn type_arguments_from_node(
        &mut self,
        ty: TypeId,
        file: FileId,
        node: TypeNodeId,
    ) -> Vec<TypeId> {
        let hir = self.hir(file);
        match (self.data(ty), hir[node].kind) {
            // `append(n.OuterTypeParameters(), c.getEffectiveTypeArguments(node, n.LocalTypeParameters())...)`
            (&TypeData::Ref { target, .. }, TypeNodeKind::Ref { args, .. }) => {
                let mut args = self.types_from_nodes(file, args);
                if hir.is_js {
                    let params = self.local_type_params_of_symbol(target);
                    args = self.fill_type_args_as(&params, &args, true);
                }
                let reference = self.type_reference(target, &args);
                self.type_arguments(reference).to_vec()
            }
            (TypeData::Ref { .. }, _) => match array_element_type_node(hir, node) {
                Some(element) => vec![self.type_from_node(file, element)],
                None => Vec::new(),
            },
            (TypeData::Tuple { .. }, TypeNodeKind::Tuple(elems)) => {
                self.tuple_element_types_from_nodes(file, elems)
            }
            _ => Vec::new(),
        }
    }

    /// `sym<args>`, where `sym` is not an import alias.
    pub fn type_reference(&mut self, sym: Sym, args: &[TypeId]) -> TypeId {
        self.type_reference_type(sym, args, None)
    }

    /// `getTypeReferenceType`. `alias`: the alias passed to `getTypeAliasInstantiation`, where
    /// `sym` is a generic type alias.
    pub(super) fn type_reference_type(
        &mut self,
        sym: Sym,
        args: &[TypeId],
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        let flags = self.files().flags(sym);
        if flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE) {
            let declared = self.declared_type(sym);
            let params = self.local_type_params_of_symbol(sym);
            if params.is_empty() {
                return declared;
            }
            let filled = self.fill_type_args(&params, args);
            // `getTypeFromClassOrInterfaceReference`: only its own type parameters get type
            // arguments. The outer type parameters of the declaration are passed through unchanged.
            let all = self.type_arguments(declared);
            let outer = &all[..all.len().saturating_sub(params.len())];
            let args = if outer.is_empty() {
                filled
            } else {
                outer.iter().copied().chain(filled).collect()
            };
            return self.intern_key(TypeKey::Ref {
                target: sym,
                args: &args,
            });
        }
        if flags.contains(SymFlags::TYPE_ALIAS) {
            let params = self.local_type_params_of_symbol(sym);
            if params.is_empty() {
                // `getDeclaredTypeOfTypeAlias`: `type BuiltinIteratorReturn = intrinsic`
                if self.is_declared_intrinsic(sym)
                    && self.atoms().bytes(self.files().symbol(sym).name) == b"BuiltinIteratorReturn"
                {
                    return if self.files().options.strict_builtin_iterator_return {
                        TypeId::UNDEFINED
                    } else {
                        TypeId::ANY
                    };
                }
                return self.declared_type(sym);
            }
            let args = self.fill_type_args(&params, args);
            if let Some(kind) = self.intrinsic_alias(sym) {
                return match kind {
                    Ok(kind) => self.string_mapping(kind, args[0]),
                    Err(()) => self.no_infer(args[0]),
                };
            }
            let declared = self.declared_type(sym);
            let mapper = self.mapper_from(&params, &args);
            return match alias {
                Some(alias) => self.instantiate_with_alias(declared, mapper, alias),
                None => self.instantiate(declared, mapper),
            };
        }
        if flags.intersects(SymFlags::TYPE) {
            return self.declared_type(sym);
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
        self.type_of_entity_at(file, scope, names, ExprId::NONE)
    }

    /// The same, where `e` is `a.b.c` as an expression that is being checked. `checkExpression` has
    /// no guard against re-entry: `this` is checked again, so that `typeof this` in the annotation
    /// of a `this` parameter requests the type of that parameter.
    fn type_of_entity_at(
        &mut self,
        file: FileId,
        scope: ScopeId,
        names: &[Atom],
        e: ExprId,
    ) -> TypeId {
        let Some(&first) = names.first() else {
            return TypeId::UNRESOLVED;
        };
        let mut ty = if first == known::this && e.is_some() {
            self.check_this_expression(file, first_identifier(self.hir(file), e))
        } else if first == known::this {
            self.this_type_in_scope(file, scope)
        } else {
            match self
                .files()
                .resolve_name(file, scope, first, SymFlags::VALUE)
            {
                Some(sym) => {
                    let ty = self.type_of_symbol(sym);
                    self.convert_auto_to_any(ty)
                }
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
        let mapper = self.identity_mapper_with_adopted(file, parent);
        self.types()
            .intern_sig(SigData::Decl { file, func, mapper })
    }

    /// `getSignatureFromDeclaration` for the constructor `func` in the declaration `class` of
    /// `sym`: its type parameters are those of the class, and its return type is the class type.
    pub(super) fn sig_of_constructor(
        &mut self,
        sym: Sym,
        file: FileId,
        class: ClassId,
        func: FnId,
    ) -> SigId {
        // `resolveAnonymousTypeMembers` also instantiates the signatures with the mappings of the
        // class's outer type parameters, and `instantiate_sig` only instantiates the type
        // parameters that the signature's mapper covers.
        let scope = self.bound(file).class_scope[class.idx()];
        let mapper = if scope.is_some() {
            let parent = self.bound(file).scopes[scope.idx()].parent;
            self.identity_mapper(file, parent)
        } else {
            MapperId::IDENTITY
        };
        self.types().intern_sig(SigData::Construct {
            class: sym,
            file,
            func,
            mapper,
        })
    }

    /// `getSignatureOfFullSignatureType`: the signature that a JSDoc `@type` tag declares for the
    /// whole of `func`.
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
        self.single_call_signature(ty)
    }

    /// `getSignaturesOfSymbol`: the signature the declaration `func` adds to its symbol.
    pub(super) fn sig_of_declaration(&mut self, file: FileId, func: FnId) -> SigId {
        match self.full_signature(file, func) {
            Some(full) => full,
            None => self.sig_of_fn(file, func),
        }
    }

    /// `getParameterTypeOfFullSignature` for the parameter of `func` at `index`.
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
            return Some(self.rest_type_at_position(&params, index, false));
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

    /// The type parameters that have not been instantiated yet.
    #[inline]
    pub fn sig_type_params(&mut self, sig: SigId) -> List<'p, TypeId> {
        let recent = self.recent_sig_type_params[sig.0 as usize % RECENT_SIGS];
        if recent.0 == sig {
            return List::Kept(recent.1);
        }
        let params = self.sig_type_params_not_recent(sig);
        // A list that is stored somewhere is final.
        if let List::Kept(kept) = params {
            self.recent_sig_type_params[sig.0 as usize % RECENT_SIGS] = (sig, kept);
        }
        params
    }

    /// `sig_type_params` for a signature that was not queried recently.
    fn sig_type_params_not_recent(&mut self, sig: SigId) -> List<'p, TypeId> {
        match self.types().sig(sig) {
            SigData::Synth { type_params, .. } => return List::Kept(type_params),
            SigData::WithReturn { sig: inner, .. } => return self.sig_type_params(*inner),
            // Most functions have none.
            SigData::Decl { file, func, .. } if self.hir(*file)[*func].type_params.is_empty() => {
                // `assignContextualParameterTypes`: `sig.typeParameters = context.typeParameters`
                // Not final until the function is checked, so it is not cached.
                return match self.takes_context(*file, *func) {
                    Some(owner) if self.is_context_sensitive(*file, owner) => {
                        List::Own(self.adopted_type_params(sig))
                    }
                    _ => List::default(),
                };
            }
            _ => {}
        }
        if let Some(kept) = self.p.sig_type_params.get_ref(&self.task, &sig) {
            return List::Kept(kept);
        }
        let scope = self.begin_scope();
        let params = self.sig_type_params_of_declaration(sig);
        if let Ok(stored) = self.end_scope_by_counters(scope) {
            let params = self.list(&params);
            let kept = (self.p.sig_type_params).insert_ref(&self.task, sig, params, stored);
            return List::Kept(kept.1);
        }
        List::Own(params)
    }

    #[inline(never)]
    fn sig_type_params_of_declaration(&mut self, sig: SigId) -> Vec<TypeId> {
        match self.types().sig(sig) {
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
                        match self.types().map(mapper, declared) {
                            None => Some(declared),
                            // `instantiateSignatureEx`: its own fresh type parameter. The declared
                            // one is an ordinary type argument: `f<T>(x)` inside `f`.
                            Some(actual) => match *self.data(actual) {
                                TypeData::TypeParam(f, t, around)
                                    if f == file && t == tp && around != MapperId::IDENTITY =>
                                {
                                    Some(actual)
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
                    .filter(|&tp| self.types().map(mapper, tp).is_none())
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
        match *self.types().sig(sig) {
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
            sig = match *self.types().sig(sig) {
                SigData::WithReturn { sig: inner, .. } => inner,
                SigData::DefaultConstruct { base, mapper, .. } => {
                    self.instantiate_sig(base?, mapper)
                }
                _ => return Some(sig),
            };
        }
    }

    /// `SignatureFlagsIsUntypedSignatureInJSFile`: a JavaScript function with untyped parameters
    /// and no contextual type. `getSignatureFromDeclaration` asks for the contextual type once,
    /// when the function is first checked, and the flag stays whatever is in progress.
    pub(super) fn is_untyped_signature_in_js_file(&mut self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !hir.is_js
            || !matches!(
                hir[func].kind,
                FnKind::Decl
                    | FnKind::Expr
                    | FnKind::Arrow
                    | FnKind::Method
                    | FnKind::Getter
                    | FnKind::Setter
                    | FnKind::Constructor
            )
            || !hir[func].params.iter().all(|p| hir[p].ty.is_none())
            || hir[func].this_ty(hir).is_some()
            || (bound.get_immediately_invoked_function_expression(hir, func)).is_some()
        {
            return false;
        }
        let crate::bind::FnOwner::Expr(e) = bound.fns[func.idx()].owner else {
            return true;
        };
        if let Some(known) = (self.p.untyped_signatures_in_js).get(&self.task, &(file, func)) {
            return known;
        }
        let is_untyped = (self.contextual_type(file, e, ContextFlags::empty())).is_none();
        let (key, stored) = ((file, func), Stored::new());
        (self.p.untyped_signatures_in_js).insert(&self.task, key, is_untyped, stored);
        is_untyped
    }

    #[inline]
    pub fn sig_params(&mut self, sig: SigId) -> List<'p, SigParam> {
        let recent = self.recent_sig_params[sig.0 as usize % RECENT_SIGS];
        if recent.0 == sig {
            return List::Kept(recent.1);
        }
        self.sig_params_not_recent(sig)
    }

    /// `sig_params` for a caller at a point where tsgo requests the types of the first `count`
    /// parameters (`getTypeAtPosition`): a cycle through one of them is a real cycle, and
    /// `sig_params_of_declaration` would treat it as caused by itself.
    pub(super) fn sig_params_up_to(&mut self, sig: SigId, count: usize) -> List<'p, SigParam> {
        // `getDefaultConstructSignatures` clones the base signature with its parameter symbols.
        if self.recent_sig_params[sig.0 as usize % RECENT_SIGS].0 != sig
            && let Some(declared) = self.default_construct_base_sig(sig)
            && let SigData::Decl { file, func, .. } | SigData::Construct { file, func, .. } =
                *self.types().sig(declared)
            && self.p.sig_params.get_ref(&self.task, &declared).is_none()
        {
            for p in self.hir(file)[func].params.iter().take(count) {
                self.type_of_param(file, p);
            }
        }
        self.sig_params(sig)
    }

    /// `kept` is the stored result of `sig_params(sig)`.
    fn cached_sig_params(&mut self, sig: SigId, kept: &'p [SigParam]) -> List<'p, SigParam> {
        self.recent_sig_params[sig.0 as usize % RECENT_SIGS] = (sig, kept);
        List::Kept(kept)
    }

    /// `sig_params` for a signature that was not queried recently.
    fn sig_params_not_recent(&mut self, sig: SigId) -> List<'p, SigParam> {
        let (file, func, mapper) = match self.types().sig(sig) {
            SigData::WithReturn { sig: inner, .. } => return self.sig_params(*inner),
            SigData::Synth { params, .. } => return self.cached_sig_params(sig, params),
            // Nothing is cached for these.
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
        if let Some(kept) = self.p.sig_params.get_ref(&self.task, &sig) {
            return self.cached_sig_params(sig, kept);
        }
        let scope = self.begin_scope();
        let params = self.sig_params_of_declaration(file, func, mapper);
        if let Ok(stored) = self.end_scope_by_counters(scope) {
            let kept = (self.p.sig_params).insert_ref(&self.task, sig, params.into(), stored);
            return self.cached_sig_params(sig, kept.1);
        }
        List::Own(params.to_vec())
    }

    #[inline(never)]
    fn sig_params_of_declaration(
        &mut self,
        file: FileId,
        func: FnId,
        mapper: MapperId,
    ) -> Vec<SigParam, &'s Arena> {
        let hir = self.hir(file);
        let mut out = Vec::with_capacity_in(hir[func].params.len(), self.arena);
        // `getImmediatelyInvokedFunctionExpression`: the argument count of the call of an
        // immediately invoked function expression.
        let bound = self.bound(file);
        let actual = bound
            .get_immediately_invoked_function_expression(hir, func)
            .map(|call| hir[call].args.len());
        // `getMinArgumentCount`: it has no minimum argument count.
        let is_untyped_in_js = self.is_untyped_signature_in_js_file(file, func);
        for (i, p) in hir[func].params.iter().enumerate() {
            let param = &hir[p];
            let name = match hir[param.pat].kind {
                PatKind::Ident(name) => name,
                _ => Atom::NONE,
            };
            // TypeScript resolves the type of a parameter when there is an argument to check
            // against it.
            // The one caller of an immediately invoked function expression has `actual` of them.
            let has_argument = actual.is_some_and(|actual| i < actual);
            if !has_argument {
                self.eager.push(self.stack.len());
            }
            let declared = self.type_of_param(file, p);
            if !has_argument {
                self.eager.pop();
            }
            // `isOptionalParameter`: it has no other caller, so a parameter that gets no argument
            // is optional.
            let is_omitted = actual.is_some_and(|actual| i >= actual)
                && param.ty.is_none()
                && !param.flags.contains(Flags::REST);
            let optional =
                param.flags.contains(Flags::OPTIONAL) || param.default.is_some() || is_omitted;
            // For callers, an optional parameter also accepts `undefined`.
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
                is_required_rest: false,
                has_declaration: true,
            });
        }
        out
    }

    pub fn sig_return(&mut self, sig: SigId) -> TypeId {
        match *self.types().sig(sig) {
            // `case sig.composite != nil`
            SigData::Synth {
                ret: TypeId::UNRESOLVED,
                ref of,
                is_union,
                ..
            } if of.len() > 1 => self.resolve_return_type(sig, |c| {
                let returns: Vec<TypeId> = of.iter().map(|&member| c.sig_return(member)).collect();
                if is_union {
                    c.union_reduced(&returns)
                } else {
                    c.intersection(&returns)
                }
            }),
            SigData::Synth { ret, .. } | SigData::WithReturn { ret, .. } => ret,
            // `case sig.target != nil`
            SigData::Decl { file, func, mapper } if self.is_instantiating(mapper) => self
                .resolve_return_type(sig, |c| {
                    let declared = c.return_type_of_fn(file, func);
                    c.instantiate_result_of_sig(declared, file, func, mapper)
                }),
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

    /// `getReturnTypeOfSignature` for a signature that is not the declared signature of a
    /// declaration: `sig.resolvedReturnType`, or the result of `resolve` between
    /// `pushTypeResolution` and `popTypeResolution`.
    fn resolve_return_type(
        &mut self,
        sig: SigId,
        resolve: impl FnOnce(&mut Self) -> TypeId,
    ) -> TypeId {
        if let Some(resolved) = self.p.resolved_return_types.get(&self.task, &sig) {
            return resolved;
        }
        if let Some(raw) = self.provisional(Query::ReturnOfSignature(sig)) {
            return TypeId(raw as u32);
        }
        if !self.enter(Query::ReturnOfSignature(sig)) {
            return if self.found_cycle {
                TypeId::ERROR
            } else {
                TypeId::UNRESOLVED
            };
        }
        let ty = resolve(self);
        let left = self.leave(Query::ReturnOfSignature(sig));
        if self.left_a_cycle {
            let stored = self.cycle_result();
            if let Some((file, func, _)) = self.sig_decl(self.types().sig_origin(sig)) {
                self.report_circular_return_type(Some(Query::ReturnOfSignature(sig)), file, func);
            }
            return (self.p.resolved_return_types).insert(&self.task, sig, TypeId::ANY, stored);
        }
        // `if sig.resolvedReturnType == nil`
        if let Some(resolved) = self.p.resolved_return_types.get(&self.task, &sig) {
            return resolved;
        }
        match left {
            Ok(stored) => {
                self.p
                    .resolved_return_types
                    .insert(&self.task, sig, ty, stored);
            }
            Err(open) => {
                self.cache_provisionally(Query::ReturnOfSignature(sig), u64::from(ty.0), open);
            }
        }
        ty
    }

    /// Whether `mapper` maps any type parameter to another type. A declared type or signature has
    /// no mapper in tsgo. Here it has a mapper of identity pairs.
    pub(super) fn is_instantiating(&self, mapper: MapperId) -> bool {
        self.types()
            .mapping(mapper)
            .iter()
            .any(|pair| pair.0 != pair.1)
    }

    /// `getThisTypeOfSignature`
    pub fn sig_this_type(&mut self, sig: SigId) -> Option<TypeId> {
        Some(self.sig_this_parameter(sig)?.0)
    }

    /// `signature.thisParameter`: its type and the signature that declares it. A context-sensitive function without a `this` parameter
    /// takes the one of its contextual signature (`assignContextualParameterTypes`: `createSymbolWithType(context.thisParameter, nil)`).
    pub(super) fn sig_this_parameter(&mut self, sig: SigId) -> Option<(TypeId, SigId)> {
        let (file, func, mapper) = match *self.types().sig(sig) {
            SigData::WithReturn { sig: inner, .. } => return self.sig_this_parameter(inner),
            SigData::Synth { this, .. } => return Some((this?, sig)),
            SigData::Decl { file, func, mapper } => (file, func, mapper),
            _ => return None,
        };
        if self.hir(file)[func].this_param.is_some() {
            let declared = self.type_of_this_parameter(file, func);
            return Some((self.instantiate(declared, mapper), sig));
        }
        let crate::bind::FnOwner::Expr(owner) = self.bound(file).fns[func.idx()].owner else {
            return None;
        };
        if !self.is_context_sensitive(file, owner) {
            return None;
        }
        let contextual = self.assigned_contextual_signature(file, func)?;
        // The contextual signature can be the function's own signature.
        if (self.sig_decl(contextual)).is_some_and(|(f, g, _)| (f, g) == (file, func)) {
            return None;
        }
        let (this, declared_by) = self.sig_this_parameter(contextual)?;
        Some((self.instantiate(this, mapper), declared_by))
    }

    pub fn sig_predicate(&mut self, sig: SigId) -> Option<Predicate> {
        let (file, func, mapper) = match *self.types().sig(sig) {
            SigData::WithReturn { sig: inner, .. } => return self.sig_predicate(inner),
            SigData::Synth {
                ref of, is_union, ..
            } if of.len() > 1 => return self.union_or_intersection_type_predicate(of, is_union),
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
        let index = if param == known::this {
            None
        } else {
            let is_named =
                |p: ParamId| matches!(hir[hir[p].pat].kind, PatKind::Ident(n) if n == param);
            let index = f.params.iter().position(is_named);
            Some(index.unwrap_or(Predicate::NO_PARAMETER))
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

    /// `TypePredicate.parameterName` of the predicate that the declaration of `sig` has.
    pub(super) fn sig_predicate_parameter_name(&self, sig: SigId) -> Option<Atom> {
        let (file, func) = match *self.types().sig(sig) {
            SigData::WithReturn { sig: inner, .. } => {
                return self.sig_predicate_parameter_name(inner);
            }
            SigData::Decl { file, func, .. } => (file, func),
            _ => return None,
        };
        let hir = self.hir(file);
        match hir.types.get(hir[func].ret.idx())?.kind {
            TypeNodeKind::Predicate { param, .. } => Some(param),
            _ => None,
        }
    }

    /// `getUnionOrIntersectionTypePredicate`
    fn union_or_intersection_type_predicate(
        &mut self,
        sigs: &[SigId],
        is_union: bool,
    ) -> Option<Predicate> {
        let mut last: Option<Predicate> = None;
        let mut types = Vec::with_capacity(sigs.len());
        for &sig in sigs {
            match self.sig_predicate(sig) {
                // All predicates must have the same target, and assertion predicates are not
                // combined.
                Some(predicate) => {
                    let differs = last.is_some_and(|last| last.param != predicate.param);
                    if predicate.asserts || differs {
                        return None;
                    }
                    types.push(predicate.ty?);
                    last = Some(predicate);
                }
                // In a union, a signature that returns `false` is skipped.
                None => {
                    if !is_union
                        || !matches!(self.sig_return(sig), TypeId::FALSE | TypeId::FRESH_FALSE)
                    {
                        return None;
                    }
                }
            }
        }
        let last = last?;
        let ty = if is_union {
            self.union(&types)
        } else {
            self.intersection(&types)
        };
        Some(Predicate {
            ty: Some(ty),
            ..last
        })
    }

    pub fn min_args(params: &[SigParam]) -> usize {
        params
            .iter()
            .rposition(|p| !p.optional && (!p.rest || p.is_required_rest))
            .map_or(0, |i| i + 1)
    }

    /// The parameter type for the argument at `index`, indexing into the rest parameter if `index`
    /// reaches it.
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
        if let TypeData::Tuple { flags, .. } = self.data(last.ty)
            && offset >= flags.len()
            && !flags
                .iter()
                .any(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
        {
            return None;
        }
        Some(self.rest_element_type(last.ty, offset))
    }

    /// The type of element `offset` of the array or tuple type a rest parameter is declared with.
    pub fn rest_element_type(&mut self, rest: TypeId, offset: usize) -> TypeId {
        if let Some(element) = self.array_element(rest) {
            return element;
        }
        match self.data(rest) {
            TypeData::Tuple { flags, .. } => {
                let elems = self.type_arguments(rest);
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
                        // `shouldDeferIndexedAccessType`: in a tuple with a variadic `...T`, only
                        // indexes within the fixed elements at either end can be resolved.
                        let fixed_at_end = flags
                            .iter()
                            .rev()
                            .take_while(|f| !f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
                            .count();
                        if flags.iter().any(|f| f.contains(ElemFlags::VARIADIC))
                            && offset >= first + fixed_at_end
                        {
                            let index = self.number_literal(offset as f64, false);
                            return self.indexed_access(rest, index);
                        }
                        // `getRestTypeOfTupleType`: from the first variable-length element on, the
                        // type is the union of the remaining elements.
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
