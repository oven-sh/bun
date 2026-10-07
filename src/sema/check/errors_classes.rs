//! Classes and interfaces checked against their base types, and errors specific to class bodies:
//! 4112 4113 4114 4115 4116 4117 4127 (`override`), 4119 to 4123 4128 (`override` in a JavaScript
//! file); 2510 2545 2797 2675 (the base type of a class); 2422 2500 (the types it implements); 2499
//! (the base types of an interface); 2725 (a class named `Object`); 2376 2377 2401 17005 (the
//! position of the `super()` call); 2715 (an abstract property read during instance
//! initialization).
//!
//! Follows `checkClassLikeDeclaration`, `checkBaseTypeAccessibility`,
//! `checkMembersForOverrideModifier`, `checkMemberForOverrideModifier`, `isValidBaseType`,
//! `checkInterfaceDeclaration`, `checkClassNameCollisionWithObject`, `checkConstructorDeclaration`
//! and `checkPropertyAccessibilityAtLocation` of TypeScript 7.0.2's checker.go.

use super::*;
use crate::bind::MemberOwner;

/// The results of `getBaseConstructorTypeOfClass` and `getBaseTypes` for a class with an `extends`
/// clause.
#[derive(Copy, Clone)]
enum ClassBase {
    /// Undetermined.
    Unknown,
    /// It has no `extends` clause, or no base types.
    Nothing,
    /// `constructor`: the type of the expression after `extends`. `base`: the first of its base
    /// types.
    Is { constructor: TypeId, base: TypeId },
}

/// The argument of `checkMemberForOverrideModifier`: a class member or a parameter property.
#[derive(Copy, Clone)]
struct Overrider {
    key: PropKey,
    flags: Flags,
    /// The member, or the constructor that has the parameter.
    member: MemberId,
    /// `NONE` for a member.
    param: ParamId,
}

/// The code `checkMemberForOverrideModifier` reports in a JavaScript file in place of `code`: the message names the `@override`
/// tag instead of the modifier. 4116 has no such variant.
fn js_override_code(code: u32) -> u32 {
    match code {
        4112 => 4121,
        4113 => 4122,
        4114 => 4119,
        4115 => 4120,
        4117 => 4123,
        4127 => 4128,
        _ => code,
    }
}

impl<'p> Checker<'p, '_> {
    // ───────────────────────────── heritage clauses of a class ─────────────────────────────

    /// `checkClassLikeDeclaration`, from `baseTypeNode` to the `implements` clauses, and `checkClassNameCollisionWithObject`.
    pub(super) fn report_class_like_declaration(&mut self, file: FileId, c: ClassId, sym: Sym) {
        let hir = self.hir(file);
        let class = &hir[c];
        let base = self.base_of_class(file, c, sym);
        if let ClassBase::Is { constructor, base } = base {
            let static_base_type = self.apparent_type(constructor);
            self.check_base_type_accessibility(file, c, static_base_type);
            if self.is_type_variable(constructor) {
                let static_type = self.type_of_symbol(sym);
                let own = self.signatures(static_type, true);
                let (start, end) = self.error_range_of_class(file, c);
                let at = (file, start, end);
                if !self.is_mixin_constructor_type(&own) {
                    self.error_at(at, 2545, &[]);
                } else if !class.flags.contains(Flags::ABSTRACT)
                    && self
                        .signatures(constructor, true)
                        .iter()
                        .any(|&sig| self.is_abstract_signature(sig))
                {
                    self.error_at(at, 2797, &[]);
                }
            } else if !matches!(
                self.symbol_of_type(static_base_type),
                Some(super::errors_small::SymbolAtLocation::Symbol(symbol))
                    if self.files().flags(symbol).contains(SymFlags::CLASS)
            ) {
                // A base constructor that is not a class must return the same type from every
                // construct signature.
                let mut returns = Vec::new();
                for sig in self.super_constructor_sigs(sym) {
                    returns.push(self.sig_return(sig));
                }
                let all_the_same = returns
                    .iter()
                    .all(|&returned| self.is_identical(returned, base));
                if !all_the_same && let Some(at) = self.place_to_report_base_at(file, c) {
                    self.error_at(at, 2510, &[]);
                }
            }
        }
        self.check_members_for_override_modifier(file, c, sym, base);
        for node in hir.ids(class.implements) {
            // `!IsEntityNameExpression(expr)`, whose type is the error type.
            if let TypeNodeKind::Heritage(expression) = hir[node].kind {
                let end = self.end_of_expr(file, expression);
                self.error_at((file, hir[node].pos, end), 2500, &[]);
            }
            if !matches!(hir[node].kind, TypeNodeKind::Ref { .. }) {
                continue;
            }
            let implemented = self.type_from_node(file, node);
            let implemented = self.reduced(implemented);
            if self.is_settled_base(implemented) && !self.is_valid_base_type(implemented) {
                let at = (file, hir[node].pos, self.end_of_type_node(file, node));
                self.error_at(at, 2422, &[]);
            }
        }
    }

    /// `getBaseConstructorTypeOfClass` and `getBaseTypes(classType)[0]` for the class `c` of `sym`.
    fn base_of_class(&mut self, file: FileId, c: ClassId, sym: Sym) -> ClassBase {
        let class = &self.hir(file)[c];
        if class.extends.is_none() {
            return ClassBase::Nothing;
        }
        let constructor = self.base_constructor_type_of_class(sym);
        if let Some(&base) = self.base_types(sym).first() {
            return ClassBase::Is { constructor, base };
        }
        let returned = match self.super_constructor_sigs(sym).first() {
            Some(&sig) => self.sig_return(sig),
            None => TypeId::ERROR,
        };
        if self.is_error_type(returned) || self.is_settled_base(returned) {
            ClassBase::Nothing
        } else {
            ClassBase::Unknown
        }
    }

    /// `checkBaseTypeAccessibility`: TS2675. A class with a private constructor can only be extended inside its own declaration.
    fn check_base_type_accessibility(&mut self, file: FileId, c: ClassId, apparent: TypeId) {
        let TypeData::Anon {
            origin: Origin::ClassStatic(class),
            ..
        } = *self.data(apparent)
        else {
            return;
        };
        let Some(&first) = self.signatures(apparent, true).first() else {
            return;
        };
        let declared = self.declared_sig(first);
        let hir = self.hir(file);
        if let Some((declared_in, func, _)) = self.sig_decl(declared)
            && self.hir(declared_in)[func].flags.contains(Flags::PRIVATE)
            && !(self.enclosing_classes(file, hir[c].extends).into_iter())
                .any(|around| self.class_sym(file, around) == class)
        {
            let name = super::errors_names_and_exports::fully_qualified_name(self, class, None);
            self.error(
                file,
                hir.node(c).with(Part::Base),
                2675,
                &[Arg::Bytes(&name)],
            );
        }
    }

    /// Whether the resolution of `ty` is final: all of it is known, and it is not deferred on type
    /// parameters that do not exist.
    pub(super) fn is_settled_base(&self, ty: TypeId) -> bool {
        self.has_type_variables(ty) || !self.is_deferred(ty)
    }

    /// `isValidBaseType`: `any`, an object type with statically known members, or an intersection
    /// of such types. A type that could not be resolved is accepted.
    pub(super) fn is_valid_base_type(&mut self, ty: TypeId) -> bool {
        if matches!(
            self.data(ty),
            TypeData::TypeParam(..) | TypeData::ThisParam(_)
        ) && let Some(constraint) = self.base_constraint_of(ty)
        {
            return self.is_valid_base_type(constraint);
        }
        match self.data(ty) {
            TypeData::Intersection(parts) => {
                parts.iter().all(|&part| self.is_valid_base_type(part))
            }
            _ => {
                (self.is_object_type(ty) || ty == TypeId::OBJECT || self.has_any_flag(ty))
                    && !self.is_generic_mapped_base(ty)
            }
        }
    }

    /// `isGenericMappedType`: its constraint type or its name type is generic.
    fn is_generic_mapped_base(&mut self, ty: TypeId) -> bool {
        if self.mapped_origin(ty).is_none() {
            return false;
        }
        if self.is_generic(ty) {
            return true;
        }
        let Some(name) = self.mapped_name_type(ty) else {
            return false;
        };
        let (param, keys) = (self.mapped_type_param(ty), self.mapped_keys(ty));
        let mapper = self.mapper_from(&[param], &[keys]);
        let name = self.instantiate(name, mapper);
        self.is_generic(name) && !self.is_pattern_literal(name)
    }

    // ───────────────────────────── base types of an interface ─────────────────────────────

    /// The end of `checkInterfaceDeclaration`: 2499.
    pub(super) fn check_bases_of_interface(&mut self, file: FileId, i: InterfaceId) {
        let hir = self.hir(file);
        for node in hir.ids(hir[i].extends) {
            if matches!(
                hir[node].kind,
                TypeNodeKind::Error | TypeNodeKind::Heritage(_)
            ) {
                let end = match hir[node].kind {
                    TypeNodeKind::Heritage(expression) => self.end_of_expr(file, expression),
                    _ => hir[node].end,
                };
                self.error_at((file, hir[node].pos, end), 2499, &[]);
            }
        }
    }

    // ───────────────────────────── override ─────────────────────────────

    /// `checkMembersForOverrideModifier`
    fn check_members_for_override_modifier(
        &mut self,
        file: FileId,
        c: ClassId,
        sym: Sym,
        base: ClassBase,
    ) {
        let hir = self.hir(file);
        let class = &hir[c];
        // Otherwise only members with `override` are visited.
        let visits_all = self.p.files.options.no_implicit_override;
        for m in class.members.iter() {
            let member = &hir[m];
            // `ModifierFlags()`: what is written before `static { }` is only in its list.
            let flags = match member.kind {
                MemberKind::StaticBlock => member.flags | hir.modifiers_to_flags(member.modifiers),
                _ => member.flags,
            };
            if !visits_all
                && !flags.contains(Flags::OVERRIDE)
                && (member.kind != MemberKind::Constructor
                    || member.func.is_some()
                        && !hir[member.func]
                            .params
                            .iter()
                            .any(|p| hir[p].flags.contains(Flags::OVERRIDE)))
            {
                continue;
            }
            // `HasAmbientModifier`: the member itself has `declare`. Every member of an ambient
            // class has `Flags::AMBIENT`.
            if hir
                .find_modifier(member.modifiers, Flags::AMBIENT)
                .is_some()
            {
                continue;
            }
            if member.kind != MemberKind::Constructor {
                let overrider = Overrider {
                    key: member.key,
                    flags,
                    member: m,
                    param: ParamId::NONE,
                };
                self.check_member_for_override_modifier(file, c, sym, base, overrider);
                continue;
            }
            for p in hir[member.func].params.iter() {
                let param = &hir[p];
                if !param.flags.contains(Flags::PARAMETER_PROPERTY) {
                    continue;
                }
                let key = match hir[param.pat].kind {
                    PatKind::Ident(name) => PropKey::Name(name),
                    _ => PropKey::None,
                };
                let overrider = Overrider {
                    key,
                    flags: param.flags,
                    member: m,
                    param: p,
                };
                self.check_member_for_override_modifier(file, c, sym, base, overrider);
            }
        }
    }

    /// `checkMemberForOverrideModifier`
    fn check_member_for_override_modifier(
        &mut self,
        file: FileId,
        c: ClassId,
        sym: Sym,
        base: ClassBase,
        member: Overrider,
    ) {
        let is_js = self.hir(file).is_js;
        let code = |code: u32| if is_js { js_override_code(code) } else { code };
        let has_override = member.flags.contains(Flags::OVERRIDE);
        let no_implicit_override = self.p.files.options.no_implicit_override;
        let (constructor, base) = match base {
            ClassBase::Unknown => return,
            ClassBase::Nothing => {
                if has_override {
                    let class_type = self.declared_type(sym);
                    let at = self.place_of_overrider(file, member);
                    self.error_at(at, code(4112), &[Arg::Type(class_type)]);
                }
                return;
            }
            ClassBase::Is { constructor, base } => (constructor, base),
        };
        if has_override
            && let PropKey::Computed(name) = member.key
            && self.is_non_bindable_dynamic_name(file, name)
        {
            let at = self.place_of_overrider(file, member);
            self.error_at(at, code(4127), &[]);
            return;
        }
        if !has_override && !no_implicit_override {
            return;
        }
        let Some(name) = self.declared_member_name(file, member.key) else {
            return;
        };
        let is_static = member.param.is_none() && member.flags.contains(Flags::STATIC);
        let this_type = if is_static {
            self.type_of_symbol(sym)
        } else {
            self.declared_type(sym)
        };
        if self.get_property_of_type(this_type, name).is_none() {
            return;
        }
        let base_type = if is_static { constructor } else { base };
        // `#x` of a class is not the `#x` of its base class.
        let base_prop = if matches!(member.key, PropKey::Private(_)) {
            None
        } else {
            self.get_property_of_type(base_type, name)
                .map(|found| found.0)
        };
        let Some(base_prop) = base_prop else {
            if has_override {
                let at = self.place_of_overrider(file, member);
                match self.suggested_member(base_type, name) {
                    Some(suggestion) => {
                        let suggestion = self.prop_to_string(suggestion);
                        let args = [Arg::Type(base), Arg::Bytes(&suggestion)];
                        self.error_at(at, code(4117), &args);
                    }
                    None => {
                        self.error_at(at, code(4113), &[Arg::Type(base)]);
                    }
                }
            }
            return;
        };
        if has_override || self.hir(file)[c].flags.contains(Flags::AMBIENT) {
            return;
        }
        let Some((true, is_abstract)) = self.declarations_of_base_property(base_prop) else {
            return;
        };
        let at = self.place_of_overrider(file, member);
        if !is_abstract {
            let must = if member.param.is_some() { 4115 } else { 4114 };
            self.error_at(at, code(must), &[Arg::Type(base)]);
        } else if member.flags.contains(Flags::ABSTRACT) {
            self.error_at(at, 4116, &[Arg::Type(base)]);
        }
    }

    /// `GetErrorRangeForNode` for the argument of `checkMemberForOverrideModifier`.
    fn place_of_overrider(&self, file: FileId, member: Overrider) -> (FileId, u32, u32) {
        if member.param.is_some() {
            let start = self.hir(file)[member.param].pos;
            return (file, start, self.end_of_param(file, member.param));
        }
        let (start, end) = self.error_range_of_member(file, member.member);
        (file, start, end)
    }

    /// `isNonBindableDynamicName` for the computed name `[e]`.
    fn is_non_bindable_dynamic_name(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        if !is_dynamic_name(hir, e) {
            return false;
        }
        // `isLateBindableAST`
        if !is_entity_name_expression(hir, e) {
            return true;
        }
        let ty = self.type_of_expr(file, e);
        // `isTypeUsableAsPropertyName`
        self.property_name_of_type(ty).is_none()
    }

    /// `getSuggestedSymbolForNonexistentClassMember`
    fn suggested_member(&mut self, ty: TypeId, name: Atom) -> Option<&'p Prop<'p>> {
        // `ast.SymbolName`: a private name is compared by its source text.
        let written = self.written_name(name);
        // The name of a symbol-keyed member is compared like any other. In tsgo it is
        // `\xFE@description@<symbol id>` (`getESSymbolLikeTypeForNode`). Where no id is handed out
        // it is assumed to have two digits, the fewest it has in a program with a default library.
        let late_bound = written
            .strip_prefix(crate::atom::SYMBOL_NAME_PREFIX)
            .map(|described| match self.symbol_name_with_id(name) {
                std::borrow::Cow::Owned(with_id) => with_id,
                std::borrow::Cow::Borrowed(_) => {
                    let description =
                        &described[..bun_core::strings::last_index_of_char(described, b'@')
                            .unwrap_or(described.len())];
                    [crate::atom::SYMBOL_NAME_PREFIX, description, &b"@00"[..]].concat()
                }
            });
        let text = late_bound.as_deref().unwrap_or(written);
        let ty = self.reduced(ty);
        let apparent = self.apparent_type(ty);
        let members = self.members(apparent)?;
        let mut candidates = Vec::new();
        for prop in &members.shape().props {
            // `getCandidateName`: an internal name is never suggested, and only
            // `SymbolFlagsClassMember` counts, which the exports of a namespace merged with the
            // class are not.
            let candidate = self.written_name(prop.name);
            if matches!(candidate.first(), Some(b'"' | 0xFE))
                || matches!(prop.source, PropSource::Symbol(sym) if !self.is_member_symbol(sym))
            {
                continue;
            }
            candidates.push((self.order_of_property(prop), candidate, prop));
        }
        // `compareSymbols` breaks ties between equally close candidates.
        get_spelling_suggestion(text, candidates.iter(), |it| it.1, |a, b| a.0.cmp(&b.0))
            .map(|found| found.2)
    }

    /// Whether `prop` has any declarations, and whether one of them is `abstract`. `None`: its
    /// origin is not recorded.
    fn declarations_of_base_property(&self, prop: &Prop) -> Option<(bool, bool)> {
        match &prop.source {
            PropSource::Symbol(sym) => {
                use crate::bind::Decl;
                let is_abstract = |&(f, d): &(FileId, Decl)| match d {
                    Decl::Member(m) => self.hir(f)[m].flags.contains(Flags::ABSTRACT),
                    Decl::ParameterProperty(p) => self.hir(f)[p].flags.contains(Flags::ABSTRACT),
                    _ => false,
                };
                Some((true, self.files().decls_of(*sym).iter().any(is_abstract)))
            }
            PropSource::Literal(..) => Some((true, false)),
            // `addMemberForKeyTypeWorker`: `prop.Declarations = modifiersProp.Declarations`
            PropSource::Intersected(..)
            | PropSource::Copy(..)
            | PropSource::ReverseMapped(..)
            | PropSource::Mapped(..) => {
                let parts = match &prop.source {
                    PropSource::Intersected(_, parts)
                    | PropSource::Copy(_, parts, _)
                    | PropSource::ReverseMapped(_, parts) => &parts[..],
                    _ => prop.declared_by_modifiers_property(),
                };
                let (mut is_declared, mut is_abstract) = (false, false);
                for part in parts {
                    let (declared, abstract_) = self.declarations_of_base_property(part)?;
                    is_declared |= declared;
                    is_abstract |= abstract_;
                }
                Some((is_declared, is_abstract))
            }
            // The `prototype` of a class is synthesized.
            PropSource::Type(_) if prop.name == known::prototype => Some((false, false)),
            _ => None,
        }
    }

    // ───────────────────────────── position of the `super()` call ─────────────────────────────

    /// The end of `checkConstructorDeclaration`: 2377 17005 2401 2376.
    /// When fields are initialized by assignments emitted into the constructor, the assignments go
    /// directly after the `super` call, which must therefore be a top-level statement of the
    /// constructor, and the first that relates to `this`.
    pub(super) fn check_super_call_in_constructor(&mut self, file: FileId, m: MemberId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_super_call = |e: ExprId| matches!(hir[e].kind, ExprKind::Call(call) if matches!(hir[hir[call].callee].kind, ExprKind::Super));
        let func = &hir[hir[m].func];
        let (FnBody::Block(body), MemberOwner::Class(c)) = (func.body, bound.member_owner[m.idx()])
        else {
            return;
        };
        if hir[c].extends.is_none() {
            return;
        }
        let class_extends_null = self.class_declaration_extends_null(self.class_sym(file, c));
        let block = hir.node(hir[m].func).with(Part::Body);
        let NodeData::Expr(first) = hir.data(self.find_first_super_call(hir, block)) else {
            if !class_extends_null {
                self.error(file, m, 2377, &[]);
            }
            return;
        };
        if class_extends_null {
            self.error(file, first, 17005, &[]);
        }
        if self.p.files.options.emit_standard_class_fields {
            return;
        }
        // `isInstancePropertyWithInitializerOrPrivateIdentifierProperty`, or a parameter property.
        let has_to_be_at_root_level = hir[c].members.iter().any(|x| {
            let member = &hir[x];
            match member.kind {
                MemberKind::Property => {
                    matches!(member.key, PropKey::Private(_))
                        || !member.flags.contains(Flags::STATIC) && member.init.is_some()
                }
                MemberKind::Method | MemberKind::Getter | MemberKind::Setter => {
                    matches!(member.key, PropKey::Private(_))
                }
                _ => false,
            }
        }) || func
            .params
            .iter()
            .any(|p| hir[p].flags.contains(Flags::PARAMETER_PROPERTY));
        if !has_to_be_at_root_level {
            return;
        }
        // `superCallIsRootLevelInConstructor`
        if !hir
            .ids(body)
            .any(|s| matches!(hir[s].kind, StmtKind::Expr(x) if x == first))
        {
            self.error(file, first, 2401, &[]);
            return;
        }
        for s in hir.ids(body) {
            if matches!(hir[s].kind, StmtKind::Expr(x) if is_super_call(self.skip_outer_expressions(file, x)))
            {
                return;
            }
            if self.node_immediately_references_super_or_this(hir, hir.node(s)) {
                break;
            }
        }
        self.error(file, m, 2376, &[]);
    }

    /// `findFirstSuperCall`
    fn find_first_super_call(&self, hir: &File, node: Node) -> Node {
        if hir.kind(node) == Kind::CallExpression
            && hir.kind(hir.expression(node)) == Kind::SuperKeyword
        {
            return node;
        }
        let mut found = Node::NONE;
        if !hir.kind(node).is_function_like() && !self.is_stack_low() {
            hir.for_each_child(node, &mut |child| {
                found = self.find_first_super_call(hir, child);
                found.is_some()
            });
        }
        found
    }

    /// `nodeImmediatelyReferencesSuperOrThis`
    fn node_immediately_references_super_or_this(&self, hir: &File, node: Node) -> bool {
        match hir.kind(node) {
            Kind::SuperKeyword | Kind::ThisKeyword => return true,
            Kind::ArrowFunction
            | Kind::FunctionDeclaration
            | Kind::FunctionExpression
            | Kind::PropertyDeclaration => return false,
            Kind::Block
                if matches!(
                    hir.kind(hir.parent(node)),
                    Kind::Constructor
                        | Kind::MethodDeclaration
                        | Kind::GetAccessor
                        | Kind::SetAccessor
                ) =>
            {
                return false;
            }
            _ => {}
        }
        !self.is_stack_low()
            && hir.for_each_child(node, &mut |child| {
                self.node_immediately_references_super_or_this(hir, child)
            })
    }
}
