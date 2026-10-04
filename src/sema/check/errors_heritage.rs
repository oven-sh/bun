//! A class or an interface checked against its base types and implemented types, and members
//! against index signatures:
//! 2415 2416 2417 2420 2720 2430 2320; 2515 2653 2654 2655 2656 2650, 2610 2611, 2423 2425 2426;
//! 2411 2413 2374.
//!
//! Follows `checkClassLikeDeclaration`, `issueMemberSpecificError`,
//! `checkKindsOfPropertyMemberOverrides`, `checkInterfaceDeclaration`,
//! `checkInheritedPropertiesAreIdentical` and `checkIndexConstraints` of TypeScript 7.0.2's
//! checker.go.

use super::relate::Relation;
use super::sink::held;
use super::*;
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner};
use smallvec::SmallVec;

/// The arguments `checkIndexConstraints` passes on.
struct IndexConstraints<'a> {
    file: FileId,
    /// `t`
    ty: TypeId,
    /// `getIndexInfosOfType(t)`
    infos: &'a [IndexInfo],
    /// The members declared directly in the declarations of `t`.
    locals: &'a [(FileId, Span<MemberId>)],
    /// `interfaceDeclaration`, for a property and an index signature that come from different base
    /// interfaces.
    interface: Option<(Node, Sym)>,
}

impl IndexConstraints<'_> {
    /// `getParentOfSymbol(getSymbolOfDeclaration(m)) == t.symbol`
    fn is_local(&self, f: FileId, m: MemberId) -> bool {
        let mut locals = self.locals.iter();
        locals.any(|&(local, span)| local == f && span.range().contains(&m.idx()))
    }

    /// `localIndexDeclaration`
    fn local_index(&self, c: &Checker<'_, '_>, info: &IndexInfo) -> Option<(FileId, Node)> {
        let (f, m) = info.declaration?;
        self.is_local(f, m).then(|| (f, c.hir(f).node(m)))
    }
}

impl Checker<'_, '_> {
    pub(super) fn check_class_heritage(&mut self, file: FileId, c: ClassId) {
        let hir = self.hir(file);
        let class = &hir[c];
        let sym = self.class_sym(file, c);
        let class_type = self.declared_type(sym);
        let name_or_node = class.name_pos;
        let this = self.intern(TypeData::ThisParam(sym));
        if class.extends.is_some()
            && let Some(&base) = self.base_types(sym).first()
        {
            match self.unrelated_with_this_argument(class_type, base, this) {
                Some(with_this) => self.issue_member_specific_error(file, c, with_this, 2415),
                // The static side is checked only if the instance side has no error.
                None => {
                    let static_type = self.type_of_symbol(sym);
                    let base_constructor = self.base_constructor_type_of_class(sym);
                    let static_base = self.apparent_type(base_constructor);
                    if let Some(properties) = self.type_without_signatures(static_base)
                        && !self.is_assignable(static_type, properties)
                    {
                        let at = (file, name_or_node, 0);
                        self.report_static_side(at, static_type, static_base, properties);
                    }
                }
            }
            self.check_kinds_of_property_member_overrides(file, c, sym, class_type, base);
        }
        for node in hir.ids(class.implements) {
            // Not the primitive type: an unresolved name.
            if matches!(hir[node].kind, TypeNodeKind::Keyword(_)) {
                continue;
            }
            let implemented = self.type_from_node(file, node);
            let implemented = self.reduced(implemented);
            if self.is_any(implemented) {
                continue;
            }
            // `isValidBaseType`: a type that cannot be implemented is not compared. That error is
            // reported with the other class checks.
            if !self.is_valid_base_type(implemented) {
                continue;
            }
            let is_class = matches!(*self.data(implemented), TypeData::Ref { target, .. } if self.files().flags(target).contains(SymFlags::CLASS));
            if let Some(with_this) =
                self.unrelated_with_this_argument(class_type, implemented, this)
            {
                let generic_diag = if is_class { 2720 } else { 2420 };
                self.issue_member_specific_error(file, c, with_this, generic_diag);
            }
        }
        let locals = self.members_of_declarations(sym);
        self.check_index_constraints(file, class_type, &locals, false, None);
        let static_type = self.type_of_symbol(sym);
        self.check_index_constraints(file, static_type, &locals, true, None);
    }

    /// The members whose `getParentOfSymbol` is `sym`: those of the class and of every interface
    /// that is merged with it.
    fn members_of_declarations(&self, sym: Sym) -> SmallVec<[(FileId, Span<MemberId>); 2]> {
        let mut members = SmallVec::new();
        for &(f, d) in self.files().decls_of(sym).iter() {
            match d {
                Decl::Interface(id) => members.push((f, self.hir(f)[id].members)),
                Decl::Class(c) => members.push((f, self.hir(f)[c].members)),
                _ => {}
            }
        }
        members
    }

    /// 2417: `checkTypeAssignableTo(staticType, getTypeWithoutSignatures(staticBaseType), ..)` has
    /// failed. `properties`: `type_without_signatures(static_base)`.
    fn report_static_side(
        &mut self,
        at: (FileId, u32, u32),
        static_type: TypeId,
        static_base: TypeId,
        properties: TypeId,
    ) {
        let members = self.members_of_type_without_signatures(static_base);
        let printed: SmallVec<[TypeId; 4]> = members.iter().map(|member| member.1).collect();
        let printed = match printed[..] {
            [only] => only,
            _ => self.intersection(&printed),
        };
        let (heir, base) = self.type_names_for_error_display(static_type, printed);
        // `typeRelatedToEachType` reports the first member that the source is not related to. If it
        // is related to each, `propertiesRelatedTo` compares with the properties of the
        // intersection.
        let mut unrelated = None;
        if members.len() > 1 {
            for &member in &members {
                if !self.is_assignable(static_type, member.0) {
                    unrelated = Some(member);
                    break;
                }
            }
        }
        let (target, shown, head, level) = match (unrelated, &members[..]) {
            (Some((bare, shown)), _) => (bare, shown, None, 1),
            (None, &[(bare, shown)]) => (bare, shown, Some(2417), 0),
            (None, _) => (properties, printed, Some(2417), 0),
        };
        let (lines, related) = self.relation_lines_with_related(
            static_type,
            target,
            Relation::Assignable,
            head,
            level,
        );
        // tsgo's type has the symbol of `shown` and is printed like it. `target` has no symbol.
        let from = self.type_to_string(target);
        let to = self.type_names_for_error_display(static_type, shown).1;
        // `reportRelationError` and `reportUnmatchedProperty` print with
        // `getTypeNamesForErrorDisplay`, whose enclosing declaration is a class expression. The
        // other lines print with `TypeToString`.
        let plain = self.type_to_string(shown);
        let mut reasons: Vec<_> = lines
            .into_iter()
            .skip(usize::from(head.is_some()))
            .collect();
        for line in &mut reasons {
            if line.args.iter().any(|arg| **arg == from[..]) {
                let to = match line.code {
                    2322 | 2375 | 2719 | 2739 | 2740 | 2741 => &to,
                    _ => &plain,
                };
                let args = line.args.iter().map(|arg| match **arg == from[..] {
                    true => to.clone(),
                    false => arg.to_vec(),
                });
                line.args = held(args.collect());
            }
        }
        let mut diagnostic = Reported::new(at, 2417, held(vec![heir, base]));
        super::explain::add_lines(&mut diagnostic.message_chain, reasons);
        diagnostic.related_information = related;
        self.add_diagnostic(diagnostic);
    }

    /// `getTypeWithoutSignatures(ty)`: the members of the intersection it returns, or that type
    /// alone. Each as the type to compare with (`type_without_signatures`), and as a type that is
    /// printed like it.
    fn members_of_type_without_signatures(
        &mut self,
        ty: TypeId,
    ) -> SmallVec<[(TypeId, TypeId); 4]> {
        let types: SmallVec<[TypeId; 4]> = match self.is_intersection(ty) {
            true => SmallVec::from_slice(self.constituents(ty)),
            false => SmallVec::from_slice(&[ty]),
        };
        let mut members: SmallVec<[(TypeId, TypeId); 4]> = SmallVec::new();
        for t in types {
            let resolved = self.members(t).filter(|resolved| {
                !(resolved.shape().call.is_empty() && resolved.shape().construct.is_empty())
            });
            let (Some(resolved), Some(bare)) = (resolved, self.type_without_signatures(t)) else {
                members.push((t, t));
                continue;
            };
            // The result has `t.symbol`, by which the node builder chooses between `typeof C` and
            // the members.
            let printed = if self.type_to_string(t).starts_with(b"typeof ") {
                t
            } else {
                let mut shape = Shape::new_in(self.arena);
                // It creates a new type on every call: two with the same properties stay two.
                shape.spread_rank = members.len() as u32;
                if let TypeData::Anon {
                    origin: Origin::ClassStatic(class),
                    ..
                } = *self.data(t)
                    && let Some(&(file, Decl::Class(c))) = self.files().decls_of(class).first()
                    && let crate::bind::ClassOwner::Expr(e) = self.bound(file).class_owner[c.idx()]
                {
                    shape.symbol_declared_at = Some((file, self.hir(file)[e].pos, e));
                }
                for prop in &resolved.shape().props {
                    let mut own = prop.clone_in(self.arena);
                    self.instantiate_prop(&mut own, resolved.mapper);
                    shape.props.push(own);
                }
                self.synth(shape)
            };
            members.push((bare, printed));
        }
        // `getIntersectionType` removes an empty object type that is next to another object type.
        if members.len() > 1 {
            let first = members[0];
            members.retain(|member| !self.is_empty_anonymous_object_type(member.1));
            if members.is_empty() {
                members.push(first);
            }
        }
        members
    }

    /// `getTypeWithoutSignatures` for the type a class extends. `None`: it cannot be extended,
    /// which is a separate error (`getBaseConstructorTypeOfClass`).
    fn type_without_signatures(&mut self, ty: TypeId) -> Option<TypeId> {
        // Among non-object types only `null` can be extended, and it is returned unchanged.
        let Some(members) = self.members(ty) else {
            return (ty == self.null_widening()).then_some(ty);
        };
        let mut shape = Shape::new_in(self.arena);
        for prop in &members.shape().props {
            // `propertiesRelatedTo` skips `prototype`. A static `#name` is neither inherited nor
            // required (`isStaticPrivateIdentifierProperty`). A property that
            // `createUnionOrIntersectionProperty` synthesizes from several is not
            // `SymbolFlagsPrototype`.
            if prop.name == known::prototype && !matches!(prop.source, PropSource::Intersected(..))
                || self.atoms().bytes(prop.name).first() == Some(&b'#')
            {
                continue;
            }
            // As declared: the origin of a private or protected property determines whether it is
            // the same property.
            let mut own = prop.clone_in(self.arena);
            self.instantiate_prop(&mut own, members.mapper);
            shape.props.push(own);
        }
        Some(self.synth(shape))
    }

    /// `getTypeWithThisArgument` of `ty` and of `base`, with `this` for both. `None`: the first is assignable to the second.
    fn unrelated_with_this_argument(
        &mut self,
        ty: TypeId,
        base: TypeId,
        this: TypeId,
    ) -> Option<[TypeId; 2]> {
        // It returns a type that is not a reference unchanged. Deciding that is costly
        // (`isThislessInterface`), and whether the two are related does not depend on it, so it is
        // evaluated only once they are found unrelated.
        let mut with_this = [ty, base].map(|t| self.type_with_this_argument(t, this));
        let [source, target] = with_this;
        if self.try_is_type_related_to(source, target, Relation::Assignable, true) == Ok(true) {
            return None;
        }
        for (t, plain) in with_this.iter_mut().zip([ty, base]) {
            if !self.takes_this_argument(plain) {
                *t = plain;
            }
        }
        Some(with_this)
    }

    /// `issueMemberSpecificError`
    fn issue_member_specific_error(
        &mut self,
        file: FileId,
        c: ClassId,
        [type_with_this, base_with_this]: [TypeId; 2],
        broad_diag: u32,
    ) {
        let hir = self.hir(file);
        let apparent_base = self.apparent_type(base_with_this);
        let mut issued_member_error = false;
        for m in hir[c].members.iter() {
            let member = &hir[m];
            if member.flags.contains(Flags::STATIC) {
                continue;
            }
            // `declaredProp.Name != ast.InternalSymbolNameComputed`
            let Some(name) = self.member_name(file, member.key) else {
                continue;
            };
            let (Some((prop, mapper)), Some((base_prop, base_mapper))) = (
                self.prop_ref(type_with_this, name),
                self.prop_ref(apparent_base, name),
            ) else {
                continue;
            };
            let (actual, expected) = (
                self.type_of_prop(prop, mapper),
                self.type_of_prop(base_prop, base_mapper),
            );
            let at = (file, member.name_pos, self.end_of_member_name(file, m));
            let mut diags = Vec::new();
            if !self.check_type_assignable_to_ex(actual, expected, Some(at), None, Some(&mut diags))
            {
                let declared = self.prop_to_string(prop);
                let args = [
                    Arg::Bytes(&declared),
                    Arg::Type(type_with_this),
                    Arg::Type(base_with_this),
                ];
                let diagnostic =
                    self.new_diagnostic_chain(diags.into_iter().next(), at, 2416, &args);
                self.add_diagnostic(diagnostic);
                issued_member_error = true;
            }
        }
        if !issued_member_error {
            let at = self.place_of_token(file, hir[c].name_pos);
            self.check_type_assignable_to(
                type_with_this,
                base_with_this,
                Some(at),
                Some(broad_diag),
            );
        }
    }

    /// The members that declare `prop`, if it is declared by members of classes or interfaces.
    fn declarations_of_prop(&mut self, prop: &Prop) -> SmallVec<[(FileId, MemberId); 2]> {
        match prop.source {
            PropSource::Symbol(sym) => self.members_of_symbol(sym),
            _ => SmallVec::new(),
        }
    }

    /// The symbol flags `checkKindsOfPropertyMemberOverrides` tests on a property: whether it is a
    /// property, has a getter, has a setter, is a method. `None`: its declarations do not determine
    /// them.
    fn kinds_of_prop(&mut self, prop: &Prop) -> Option<(bool, bool, bool, bool)> {
        match &prop.source {
            PropSource::Symbol(sym) => {
                let flags = self.flags_of_property(*sym);
                // A property declared by an assignment does not determine them.
                let tells = flags.intersects(SymFlags::CLASS_MEMBER)
                    && !self.is_declared_by_assignment(*sym);
                tells.then_some((
                    flags.contains(SymFlags::PROPERTY),
                    flags.contains(SymFlags::GET_ACCESSOR),
                    flags.contains(SymFlags::SET_ACCESSOR),
                    flags.contains(SymFlags::METHOD),
                ))
            }
            // `createUnionOrIntersectionProperty`: accessors if all the members of the intersection
            // have the same ones, else a property.
            // Also a method (`CheckFlagsSyntheticMethod`) if it is one in all of them.
            PropSource::Intersected(_, parts) => {
                let mut all: Option<(bool, bool, bool, bool)> = None;
                for part in parts.iter() {
                    let (_, getter, setter, method) = self.kinds_of_prop(part)?;
                    all = Some(match all {
                        None => (!(getter || setter), getter, setter, method),
                        Some((false, g, s, m)) if (g, s) == (getter, setter) => {
                            (false, g, s, m && method)
                        }
                        Some((_, _, _, m)) => (true, false, false, m && method),
                    });
                }
                all
            }
            _ => None,
        }
    }

    /// Whether an interface declares `prop`, or one of the properties an intersection combines into
    /// it.
    fn is_declared_in_interface(&self, prop: &Prop) -> bool {
        match &prop.source {
            PropSource::Symbol(sym) => {
                let members = members_among(&self.files().decls_of(*sym));
                members.iter().any(|&(f, m)| {
                    matches!(
                        self.bound(f).member_owner[m.idx()],
                        MemberOwner::Interface(_)
                    )
                })
            }
            PropSource::Intersected(_, parts) => {
                parts.iter().any(|part| self.is_declared_in_interface(part))
            }
            _ => false,
        }
    }

    /// `checkKindsOfPropertyMemberOverrides`
    fn check_kinds_of_property_member_overrides(
        &mut self,
        file: FileId,
        c: ClassId,
        sym: Sym,
        class_type: TypeId,
        base: TypeId,
    ) {
        let hir = self.hir(file);
        // `getPropertiesOfType`
        let apparent_base = self.apparent_type(base);
        let (Some(base_members), Some(own_members)) =
            (self.members(apparent_base), self.members(class_type))
        else {
            return;
        };
        let is_abstract_class = hir[c].flags.contains(Flags::ABSTRACT);
        let mut not_implemented = 0;
        let mut missed: Vec<&Prop> = Vec::new();
        for inherited in &base_members.shape().props {
            let Some(derived) = own_members.resolved.prop(inherited.name) else {
                continue;
            };
            let base_decls = self.declarations_of_prop(inherited);
            // Only with a grammar error.
            let is_abstract_parameter = match inherited.source {
                PropSource::Symbol(symbol) => match self.files().value_declaration(symbol) {
                    Some((f, Decl::ParameterProperty(p))) => {
                        self.hir(f)[p].flags.contains(Flags::ABSTRACT)
                    }
                    _ => false,
                },
                _ => false,
            };
            let is_abstract = is_abstract_parameter
                || base_decls
                    .iter()
                    .any(|&(f, m)| self.hir(f)[m].flags.contains(Flags::ABSTRACT));
            if derived.source == inherited.source {
                // Inherited unchanged. An abstract member must be implemented, unless the class is
                // abstract as well.
                if is_abstract && !is_abstract_class {
                    let elsewhere = self.base_types(sym).iter().any(|&other| {
                        other != base
                            && self
                                .prop_ref(other, inherited.name)
                                .is_some_and(|(p, _)| p.source != inherited.source)
                    });
                    if !elsewhere {
                        not_implemented += 1;
                        missed.push(inherited);
                    }
                }
                continue;
            }
            // `getDeclarationModifierFlagsFromSymbol`: a property shared by several members of an
            // intersection is private if it is private in any of them.
            let is_private_somewhere = matches!(&inherited.source, PropSource::Intersected(_, parts) if parts.iter().any(|part| part.flags.contains(PropFlags::PRIVATE)));
            if (inherited.flags | derived.flags).contains(PropFlags::PRIVATE)
                || is_private_somewhere
            {
                continue;
            }
            // The name of `derived.ValueDeclaration`.
            let PropSource::Symbol(sym) = derived.source else {
                continue;
            };
            let Some((derived_file, declaration)) = self.files().value_declaration(sym) else {
                continue;
            };
            let Some(start) = self.declaration_name_start(derived_file, declaration) else {
                continue;
            };
            if derived_file != file {
                continue;
            }
            let (Some(base_kinds), Some(derived_kinds)) =
                (self.kinds_of_prop(inherited), self.kinds_of_prop(derived))
            else {
                continue;
            };
            let (base_property, base_getter, base_setter, base_method) = base_kinds;
            let (derived_property, derived_getter, derived_setter, derived_method) = derived_kinds;
            let (base_accessor, derived_accessor) =
                (base_getter || base_setter, derived_getter || derived_setter);
            if (base_property || base_accessor) && (derived_property || derived_accessor) {
                // `arePropertiesAbstractOrInterface`: all the declarations, or one of the
                // properties an intersection combines.
                let is_abstract_or_interface = match &inherited.source {
                    PropSource::Intersected(..) => self.is_declared_in_interface(inherited),
                    _ => {
                        (is_abstract_parameter || !base_decls.is_empty())
                            && base_decls.iter().all(|&(f, m)| {
                                matches!(
                                    self.bound(f).member_owner[m.idx()],
                                    MemberOwner::Interface(_)
                                ) || is_abstract
                                    && (self.hir(f)[m].kind != MemberKind::Property
                                        || self.hir(f)[m].init.is_none())
                            })
                    }
                };
                if is_abstract_or_interface {
                    continue;
                }
                if base_accessor && !base_property && derived_property && !derived_accessor {
                    self.report_override((file, start), 2610, inherited, base, class_type);
                } else if base_property && !base_accessor && derived_accessor {
                    self.report_override((file, start), 2611, inherited, base, class_type);
                } else if self.p.files.options.use_define_for_class_fields
                    && !is_abstract
                    && self.is_redefined_without_initializer(file, c, derived, class_type)
                {
                    let end = self.end_of_name_at(file, start);
                    {
                        let arg0 = self.prop_to_string(inherited);
                        self.error_at(
                            (file, start, end),
                            2612,
                            &[Arg::Bytes(&arg0), Arg::Type(base)],
                        );
                    }
                }
            } else if base_method {
                if !(derived_method || derived_property) {
                    self.report_override((file, start), 2423, inherited, base, class_type);
                }
            } else if base_accessor {
                self.report_override((file, start), 2426, inherited, base, class_type);
            } else {
                self.report_override((file, start), 2425, inherited, base, class_type);
            }
        }
        if not_implemented > 0 {
            let is_expression =
                matches!(self.bound(file).class_owner[c.idx()], ClassOwner::Expr(_));
            let code = match (not_implemented, is_expression) {
                (1, false) => 2515,
                (1, true) => 2653,
                (2..=5, false) => 2654,
                (2..=5, true) => 2656,
                (_, false) => 2655,
                (_, true) => 2650,
            };
            let start = hir[c].name_pos;
            {
                let names: Vec<Vec<u8>> = missed
                    .iter()
                    .map(|prop| self.prop_to_string(prop))
                    .collect();
                let listed = if names.len() > 5 { 4 } else { names.len() };
                let list = match &names[..] {
                    [only] => only.clone(),
                    _ => names[..listed]
                        .iter()
                        .map(|name| cat!(b"'", name, b"'"))
                        .collect::<Vec<_>>()
                        .join(&b", "[..]),
                };
                let mut args = Vec::new();
                if !is_expression {
                    args.push(self.type_to_string(class_type));
                }
                let base_name = self.type_to_string(base);
                if names.len() == 1 {
                    args.extend([list, base_name]);
                } else {
                    args.extend([base_name, list]);
                }
                if names.len() > 5 {
                    args.push(super::sink::number_text(names.len() - 4));
                }
                self.add_diagnostic(super::sink::Reported::new(
                    (file, start, 0),
                    code,
                    held(args),
                ));
            }
        }
    }

    /// The end of `checkKindsOfPropertyMemberOverrides`, under `useDefineForClassFields`: whether a
    /// declaration of `derived` in the class `c` has no initializer, so that it redefines the
    /// property, and the constructor does not assign to it either.
    fn is_redefined_without_initializer(
        &mut self,
        file: FileId,
        c: ClassId,
        derived: &Prop,
        class_type: TypeId,
    ) -> bool {
        let hir = self.hir(file);
        let decls = self.declarations_of_prop(derived);
        if decls.is_empty()
            || hir.kind == FileKind::Declaration
            || hir[c].flags.contains(Flags::AMBIENT)
            || decls.iter().any(|&(f, m)| {
                let member = &self.hir(f)[m];
                // `SymbolFlagsTransient`: `lateBindMember` created the symbol.
                member.flags.intersects(Flags::AMBIENT | Flags::ABSTRACT)
                    || matches!(member.key, PropKey::Computed(name) if is_dynamic_name(self.hir(f), name))
            })
        {
            return false;
        }
        // `IsPropertyDeclaration`: of a class, not of an interface that is merged with it.
        let uninitialized = decls.iter().find(|&&(f, m)| {
            let member = &self.hir(f)[m];
            member.kind == MemberKind::Property
                && member.init.is_none()
                && matches!(self.bound(f).member_owner[m.idx()], MemberOwner::Class(_))
        });
        let Some(&(of, uninitialized)) = uninitialized else {
            return false;
        };
        let member = &self.hir(of)[uninitialized];
        let is_identifier = !member.flags.contains(Flags::LITERAL_NAME)
            && self.hir(of).text.get(member.name_pos as usize) != Some(&b'[');
        // `FindConstructorDeclaration`: the first that has a body.
        let constructor = hir[c].members.iter().find(|&m| {
            hir[m].kind == MemberKind::Constructor && !matches!(hir[hir[m].func].body, FnBody::None)
        });
        let (Some(constructor), PropKey::Name(name), true) =
            (constructor, member.key, is_identifier)
        else {
            return true;
        };
        member.flags.contains(Flags::DEFINITE)
            || !self.p.files.options.strict_null_checks
            || !self.is_assigned_in_constructor(file, hir[constructor].func, name, class_type)
    }

    /// Reports a `checkKindsOfPropertyMemberOverrides` error at the name of the member that overrides `inherited`.
    fn report_override(
        &mut self,
        (file, start): (FileId, u32),
        code: u32,
        inherited: &Prop,
        base: TypeId,
        heir: TypeId,
    ) {
        let (name, base, heir) = (Arg::Prop(inherited), Arg::Type(base), Arg::Type(heir));
        let args = match code {
            2610 | 2611 => [name, base, heir],
            _ => [base, name, heir],
        };
        self.error_at((file, start, self.end_of_name_at(file, start)), code, &args);
    }

    pub(super) fn check_interface_heritage(&mut self, file: FileId, i: InterfaceId) {
        let sym = self
            .files()
            .sym(file, self.bound(file).interface_symbol[i.idx()]);
        let decls = self.files().decls_of(sym);
        let interfaces = decls.iter().filter_map(|&(f, d)| match d {
            Decl::Interface(id) => Some((f, id)),
            _ => None,
        });
        // `interfaceChecked`: once for the interface, at the first of its declarations that is
        // checked. Each checker of `checkerPool` has that flag. `decls` is in the order of merging,
        // where the scripts come before every `declare global`.
        let (files, checker_count) = (self.files(), self.task.checker_count);
        let checker_of = |f: FileId| files.rank_of_file(f).checked_rem(checker_count);
        let order = |&(f, id): &(FileId, InterfaceId)| {
            self.place_in_program_order(f, self.hir(f)[id].name_pos)
        };
        let first = (interfaces.clone())
            .filter(|&(f, _)| self.reports_semantic_errors(f) && checker_of(f) == checker_of(file))
            .min_by_key(order);
        let is_first = first == Some((file, i));
        let is_first_in_file = interfaces
            .clone()
            .filter(|it| it.0 == file)
            .min_by_key(order)
            == Some((file, i));
        // `ast.GetDeclarationOfKind(t.symbol, ast.KindInterfaceDeclaration)`
        let interface_declaration = interfaces.clone().next();
        let ty = self.declared_type(sym);
        let name_pos = self.hir(file)[i].name_pos;
        let bases = self.base_types(sym);
        if is_first {
            let at = self.place_of_token(file, name_pos);
            if !self.check_inherited_properties_are_identical(sym, ty, &bases, Some(at)) {
                return;
            }
            let this = self.intern(TypeData::ThisParam(sym));
            for &base in bases.iter() {
                // `resolveBaseTypesOfInterface`: a type that cannot be extended is not a base type.
                if !self.is_valid_base_type(base) {
                    continue;
                }
                if let Some([type_with_this, base_with_this]) =
                    self.unrelated_with_this_argument(ty, base, this)
                {
                    self.check_type_assignable_to(
                        type_with_this,
                        base_with_this,
                        Some(at),
                        Some(2430),
                    );
                }
            }
        } else if !self.check_inherited_properties_are_identical(sym, ty, &bases, None) {
            return;
        }
        let locals = self.members_of_declarations(sym);
        // `check_index_constraints` reports what is in `file`.
        if !is_first_in_file {
            return;
        }
        // None is reported where a class has the same name: the type is then that of the class
        // (`ObjectFlagsInterface`).
        let is_class = self.files().flags(sym).contains(SymFlags::CLASS);
        let fallback = interface_declaration
            .filter(|&(f, _)| f == file && !is_class)
            .map(|(_, id)| (self.hir(file).node(id), sym));
        self.check_index_constraints(file, ty, &locals, false, fallback);
    }

    /// `checkInheritedPropertiesAreIdentical`. `type_node`: where to report, if at all.
    fn check_inherited_properties_are_identical(
        &mut self,
        sym: Sym,
        ty: TypeId,
        bases: &[TypeId],
        type_node: Option<(FileId, u32, u32)>,
    ) -> bool {
        if bases.len() < 2 {
            return true;
        }
        // A property it declares itself resolves any conflict.
        let mut own: Vec<Atom> = Vec::new();
        for (f, d) in self.files().decls(sym) {
            let members = match d {
                Decl::Interface(id) => self.hir(f)[id].members,
                Decl::Class(c) => self.hir(f)[c].members,
                _ => continue,
            };
            for m in members.iter() {
                let key = self.hir(f)[m].key;
                if let Some(name) = self.member_name(f, key) {
                    own.push(name);
                }
            }
        }
        let this = self.intern(TypeData::ThisParam(sym));
        let access = PropFlags::PRIVATE | PropFlags::PROTECTED;
        // For a private or protected property, also its declaration.
        let mut seen: Vec<(Atom, TypeId, PropFlags, Option<&PropSource>, TypeId)> = Vec::new();
        let mut identical = true;
        for &declared_base in bases {
            // In each base, `this` is instantiated with the `this` type of the derived type.
            let base = self.type_with_this_argument(declared_base, this);
            let Some(members) = self.members(base) else {
                continue;
            };
            for prop in &members.shape().props {
                if own.contains(&prop.name) {
                    continue;
                }
                let prop_type = self.type_of_prop_as_read(prop, members.mapper);
                match seen.iter().find(|s| s.0 == prop.name) {
                    None => seen.push((
                        prop.name,
                        prop_type,
                        prop.flags,
                        prop.flags.intersects(access).then_some(&prop.source),
                        declared_base,
                    )),
                    // `isPropertyIdenticalTo`, `compareProperties`
                    Some((_, other, flags, source, from)) => {
                        let (other, flags, from) = (*other, *flags, *from);
                        // Non-public properties are identical only if they have the same
                        // declaration. For the rest, optionality is compared.
                        let same = if flags.intersects(access) {
                            PropFlags::READONLY
                        } else {
                            PropFlags::OPTIONAL | PropFlags::READONLY
                        };
                        if flags & access == prop.flags & access
                            && (!flags.intersects(access) || *source == Some(&prop.source))
                            && flags & same == prop.flags & same
                            && (self.is_identical(other, prop_type))
                        {
                            continue;
                        }
                        let Some(at) = type_node else {
                            return false;
                        };
                        identical = false;
                        let (first, second) = (
                            self.type_to_string(from),
                            self.type_to_string(declared_base),
                        );
                        let name = self.prop_to_string(prop);
                        let args = [Arg::Bytes(&name), Arg::Bytes(&first), Arg::Bytes(&second)];
                        let error_info = self.new_diagnostic(at, 2319, &args);
                        let args = [Arg::Type(ty), args[1], args[2]];
                        let diagnostic =
                            self.new_diagnostic_chain(Some(error_info), at, 2320, &args);
                        self.add_diagnostic(diagnostic);
                    }
                }
            }
        }
        identical
    }

    /// `checkIndexConstraints`. `locals`, `interface`: see `IndexConstraints`.
    pub(super) fn check_index_constraints(
        &mut self,
        file: FileId,
        ty: TypeId,
        locals: &[(FileId, Span<MemberId>)],
        is_static: bool,
        interface: Option<(Node, Sym)>,
    ) {
        let Some(members) = self.members(ty) else {
            return;
        };
        if members.shape().index.is_empty() {
            return;
        }
        let infos: Vec<IndexInfo> = (members.shape().index.iter())
            .map(|i| IndexInfo {
                value: self.instantiate(i.value, members.mapper),
                ..*i
            })
            .collect();
        let cx = IndexConstraints {
            file,
            ty,
            infos: &infos,
            locals,
            interface,
        };
        for prop in &members.shape().props {
            if !(is_static && prop.name == known::prototype) {
                let prop_type = self.type_of_prop_as_read(prop, members.mapper);
                self.check_index_constraint_for_property(&cx, prop, None, prop_type);
            }
        }
        // The members of a class whose names are only known at run time (`hasBindableName`): each
        // is a separate property.
        for &(f, span) in locals.iter().filter(|local| local.0 == file) {
            for m in span.iter() {
                let member = self.hir(f)[m];
                let PropKey::Computed(key) = member.key else {
                    continue;
                };
                if !matches!(self.bound(f).member_owner[m.idx()], MemberOwner::Class(_))
                    || member.flags.contains(Flags::STATIC) != is_static
                    || !matches!(
                        member.kind,
                        MemberKind::Property
                            | MemberKind::Method
                            | MemberKind::Getter
                            | MemberKind::Setter
                    )
                    || self.member_name(f, member.key).is_some()
                {
                    continue;
                }
                let name_type = self.get_type_of_expression(f, key);
                let flags = if member.flags.contains(Flags::OPTIONAL) {
                    PropFlags::OPTIONAL
                } else {
                    PropFlags::empty()
                };
                let prop = Prop {
                    name: Atom::NONE,
                    flags,
                    source: PropSource::Symbol(self.symbol_of_member(f, m)),
                    mapper: MapperId::IDENTITY,
                };
                let prop_type = self.type_of_prop_as_read(&prop, members.mapper);
                self.check_index_constraint_for_property(&cx, &prop, Some(name_type), prop_type);
            }
        }
        if infos.len() > 1 {
            for check in &infos {
                self.check_index_constraint_for_index_signature(&cx, check);
            }
        }
    }

    /// `checkIndexConstraintForProperty`. `name_type`: `propNameType`, for a name only known at run
    /// time.
    fn check_index_constraint_for_property(
        &mut self,
        cx: &IndexConstraints<'_>,
        prop: &Prop,
        name_type: Option<TypeId>,
        prop_type: TypeId,
    ) {
        let is_private = name_type.is_none() && self.is_private_identifier_symbol(prop.name);
        if is_private {
            return;
        }
        let declarations = match prop.source {
            PropSource::Symbol(sym) => self.declarations_of_property(sym),
            _ => List::default(),
        };
        // `localPropDeclaration`
        let local_prop = declarations.iter().find_map(|&(f, decl)| match decl {
            Decl::ParameterProperty(p) => {
                let bound = self.bound(f);
                matches!(bound.fns[bound.param_fn[p.idx()].idx()].owner, FnOwner::Member(m) if cx.is_local(f, m))
                    .then(|| (f, self.hir(f).node(p)))
            }
            Decl::Member(m) if cx.is_local(f, m) => Some((f, self.hir(f).node(m))),
            _ => None,
        });
        for info in cx.infos {
            let applies = match name_type {
                Some(name_type) => self.is_applicable_index_type(name_type, info.key),
                None => self.is_property_applicable_to_index(cx.ty, prop, info.key),
            };
            if !applies {
                continue;
            }
            let mut error_node = local_prop.or_else(|| cx.local_index(self, info));
            if error_node.is_none()
                && let Some((interface, sym)) = cx.interface
                && !self.base_types(sym).iter().any(|&base| {
                    self.prop_ref(base, prop.name).is_some()
                        && (self.members(base))
                            .is_some_and(|m| m.shape().index.iter().any(|i| i.key == info.key))
                })
            {
                error_node = Some((cx.file, interface));
            }
            let Some((_, error_node)) = error_node.filter(|at| at.0 == cx.file) else {
                continue;
            };
            if self.is_assignable(prop_type, info.value) {
                continue;
            }
            // `propDeclaration`
            let mut related = None;
            if local_prop.is_none()
                && let Some(&(of, Decl::Member(m))) = declarations.first()
                && let (text, member) = (&self.hir(of).text, &self.hir(of)[m])
                && (matches!(member.key, PropKey::Computed(_))
                    || text.get(member.name_pos as usize) == Some(&b'['))
            {
                let place = if text.is_empty() {
                    self.place_of_token(of, member.name_pos)
                } else {
                    let (from, to) = self.error_range_of_member(of, m);
                    (of, from, to)
                };
                let name = self.prop_to_string(prop);
                related = Some(self.declared_here(place, name));
            }
            let (start, end) = self.get_error_range_for_node(cx.file, error_node);
            // `symbolToString`: a name only known at run time is printed as its source text.
            let name = match name_type {
                Some(_) => self.source_text(cx.file, start, end),
                None => self.prop_to_string(prop),
            };
            let (key, value) = (Arg::Type(info.key), Arg::Type(info.value));
            let args = [Arg::Bytes(&name), Arg::Type(prop_type), key, value];
            let diagnostic = self.error_at((cx.file, start, end), 2411, &args);
            diagnostic.related_information.extend(related);
        }
    }

    /// `checkIndexConstraintForIndexSignature`
    fn check_index_constraint_for_index_signature(
        &mut self,
        cx: &IndexConstraints<'_>,
        check: &IndexInfo,
    ) {
        for info in cx.infos {
            if info.key == check.key || !self.is_applicable_index_type(check.key, info.key) {
                continue;
            }
            let mut error_node = cx
                .local_index(self, check)
                .or_else(|| cx.local_index(self, info));
            if error_node.is_none()
                && let Some((interface, sym)) = cx.interface
                && !self.base_types(sym).iter().any(|&base| {
                    self.members(base).is_some_and(|m| {
                        let index = &m.shape().index;
                        index.iter().any(|i| i.key == check.key)
                            && index.iter().any(|i| i.key == info.key)
                    })
                })
            {
                error_node = Some((cx.file, interface));
            }
            if let Some((_, error_node)) = error_node.filter(|at| at.0 == cx.file)
                && !self.is_assignable(check.value, info.value)
            {
                let (checked, applicable) = (Arg::Type(check.value), Arg::Type(info.value));
                let args = [
                    Arg::Type(check.key),
                    checked,
                    Arg::Type(info.key),
                    applicable,
                ];
                self.error(cx.file, error_node, 2413, &args);
            }
        }
    }
}
