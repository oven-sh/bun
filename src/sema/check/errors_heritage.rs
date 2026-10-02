//! A class or an interface against what it extends and implements, and members against index signatures:
//! 2415 2416 2417 2420 2720 2430 2320; 2515 2653 2654 2655 2656 2650, 2610 2611, 2423 2425 2426; 2411 2413 2374.
//!
//! Follows `checkClassLikeDeclaration`, `issueMemberSpecificError`, `checkKindsOfPropertyMemberOverrides`,
//! `checkInterfaceDeclaration`, `checkInheritedPropertiesAreIdentical` and `checkIndexConstraints` of TypeScript 7.0.2's checker.go.

use super::errors::Diagnostic;
use super::relate::Relation;
use super::*;
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner};
use smallvec::SmallVec;

/// The node an error of `checkIndexConstraints` is reported on.
#[derive(Copy, Clone)]
enum Reported {
    Member(MemberId),
    Param(ParamId),
    /// The name of the interface.
    Name,
}

impl Checker<'_> {
    pub(super) fn check_heritage(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for c in 0..hir.classes.len() {
            let is_bound = match bound.class_owner[c] {
                ClassOwner::Expr(x) => x.is_some() && !bound.is_unchecked(x.idx()),
                ClassOwner::Stmt(s) => s.is_some(),
            };
            if is_bound && bound.class_symbol[c].is_some() {
                self.check_class_heritage(file, ClassId(c as u32), out);
            }
        }
        for i in 0..hir.interfaces.len() {
            if bound.interface_symbol[i].is_some() {
                self.check_interface_heritage(file, InterfaceId(i as u32), out);
            }
        }
        for t in 0..hir.types.len() {
            if let TypeNodeKind::Object(members) = hir.types[t].kind
                && !bound.is_unchecked_type(t)
                && members
                    .iter()
                    .any(|m| hir[m].kind == MemberKind::IndexSignature)
            {
                let ty = self.type_from_node(file, TypeNodeId(t as u32));
                self.check_index_constraints(file, ty, &[(file, members)], false, None, out);
            }
        }
    }

    fn check_class_heritage(&mut self, file: FileId, c: ClassId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        let class = &hir[c];
        let sym = self
            .files()
            .sym(file, self.bound(file).class_symbol[c.idx()]);
        let class_type = self.declared_type(sym);
        if !self.is_known(class_type) {
            return;
        }
        let name_or_node = if class.name.is_some() {
            class.name_pos
        } else {
            class.pos
        };
        let this = self.intern(TypeData::ThisParam(sym));
        if class.extends.is_some()
            && let Some(&base) = self.base_types(sym).first()
            && self.is_known(base)
        {
            match self.heir_against_base(class_type, base, this) {
                Some(with_this) => self.issue_member_specific_error(
                    file,
                    c,
                    (class_type, base),
                    with_this,
                    2415,
                    out,
                ),
                // The static side is looked at only if the instances are in order.
                None => {
                    let static_type = self.type_of_symbol(sym);
                    let base_constructor = self.base_constructor_type_of_class(sym);
                    let static_base = self.apparent_type(base_constructor);
                    if self.is_known(static_type)
                        && self.is_known(static_base)
                        && let Some(properties) = self.type_without_signatures(static_base)
                        && !self.is_assignable(static_type, properties)
                    {
                        // `properties` goes by the name of what it is made from.
                        self.explain(name_or_node, 2417, |c| {
                            let (heir, base) =
                                c.type_names_for_error_display(static_type, static_base);
                            vec![heir, base]
                        });
                        let static_base = if self.explains
                            && self.fits_each_without_signatures(static_type, static_base)
                        {
                            properties
                        } else {
                            static_base
                        };
                        if self.explains {
                            let (lines, related) = self.relation_lines_with_related(
                                static_type,
                                static_base,
                                super::relate::Relation::Assignable,
                                Some(2417),
                                0,
                            );
                            self.explain_chain(name_or_node, 2417, |_| {
                                lines.into_iter().skip(1).collect()
                            });
                            self.relate(name_or_node, 2417, |_| related);
                        }
                        self.report_not_assignable(
                            static_type,
                            properties,
                            name_or_node,
                            2417,
                            out,
                        );
                    }
                }
            }
            self.check_kinds_of_property_member_overrides(file, c, sym, class_type, base, out);
        }
        for node in hir.ids(class.implements) {
            // Not the primitive type: a name that nothing goes by.
            if matches!(hir[node].kind, TypeNodeKind::Keyword(_)) {
                continue;
            }
            let implemented = self.type_from_node(file, node);
            let implemented = self.reduced(implemented);
            if !self.is_known(implemented) || self.is_any(implemented) {
                continue;
            }
            // `isValidBaseType`: what cannot be implemented is not compared with. That it cannot is said with the other checks of classes.
            if !self.is_valid_base_type(implemented) {
                continue;
            }
            let is_class = matches!(*self.data(implemented), TypeData::Ref { target, .. } if self.files().flags(target).contains(SymFlags::CLASS));
            if let Some(with_this) = self.heir_against_base(class_type, implemented, this) {
                self.issue_member_specific_error(
                    file,
                    c,
                    (class_type, implemented),
                    with_this,
                    if is_class { 2720 } else { 2420 },
                    out,
                );
            }
        }
        let locals = [(file, class.members)];
        self.check_index_constraints(file, class_type, &locals, false, None, out);
        let static_type = self.type_of_symbol(sym);
        self.check_index_constraints(file, static_type, &locals, true, None, out);
    }

    /// Whether `base` is an intersection and `ty` fits each member of it less its signatures.
    fn fits_each_without_signatures(&mut self, ty: TypeId, base: TypeId) -> bool {
        if !self.is_intersection(base) {
            return false;
        }
        for &part in self.constituents(base) {
            if let Some(bare) = self.type_without_signatures(part)
                && !self.is_assignable(ty, bare)
            {
                return false;
            }
        }
        true
    }

    /// `getTypeWithoutSignatures`, of what a class extends. `None`: that cannot be extended, which is an error of its own
    /// (`getBaseConstructorTypeOfClass`).
    fn type_without_signatures(&mut self, ty: TypeId) -> Option<TypeId> {
        // Of what is no object only `null` can be extended, and it is left as it is.
        let Some(members) = self.members(ty) else {
            return (ty == TypeId::NULL).then_some(ty);
        };
        let mut shape = Shape::default();
        for prop in &members.shape().props {
            // `propertiesRelatedTo` passes over `prototype`. A static `#name` is neither inherited nor asked for
            // (`isStaticPrivateIdentifierProperty`). What `createUnionOrIntersectionProperty` makes of several is no
            // `SymbolFlagsPrototype`.
            if prop.name == known::prototype && !matches!(prop.source, PropSource::Intersected(..))
                || self.files().atoms.bytes(prop.name).first() == Some(&b'#')
            {
                continue;
            }
            // As it is declared: where a private or protected one comes from tells whether it is the same.
            let mut own = prop.clone();
            self.instantiate_prop(&mut own, members.mapper);
            shape.props.push(own);
        }
        Some(self.synth(shape))
    }

    /// `getTypeWithThisArgument`: what `ty` has, with `this_argument` for `this`. A reference has no place for that, so the type is
    /// made up.
    fn with_this_argument(&mut self, ty: TypeId, this_argument: TypeId) -> TypeId {
        match self.data(ty) {
            TypeData::Ref { target, .. } => {
                let own_this = self.intern(TypeData::ThisParam(*target));
                let Some(members) = self.members(ty) else {
                    return ty;
                };
                let mut pairs = self.p.types.mapping(members.mapper).to_vec();
                for pair in &mut pairs {
                    if pair.0 == own_this {
                        pair.1 = this_argument;
                    }
                }
                // With nothing to put for anything, what is inherited as it is stays the very same on both sides.
                let mapper = if pairs.iter().all(|pair| pair.0 == pair.1) {
                    MapperId::IDENTITY
                } else {
                    self.p.types.mapper(pairs)
                };
                let mut shape = Shape::default();
                for prop in &members.shape().props {
                    let mut prop = prop.clone();
                    self.instantiate_prop(&mut prop, mapper);
                    shape.props.push(prop);
                }
                for &sig in &members.shape().call {
                    let sig = self.instantiate_sig(sig, mapper);
                    shape.call.push(sig);
                }
                for &sig in &members.shape().construct {
                    let sig = self.instantiate_sig(sig, mapper);
                    shape.construct.push(sig);
                }
                for info in &members.shape().index {
                    let value = self.instantiate(info.value, mapper);
                    shape.index.push(IndexInfo { value, ..*info });
                }
                self.synth(shape)
            }
            TypeData::Intersection(parts) => {
                let parts: Vec<TypeId> = parts
                    .iter()
                    .map(|&part| self.with_this_argument(part, this_argument))
                    .collect();
                self.intersection(&parts)
            }
            _ => ty,
        }
    }

    /// `checkTypeAssignableTo(typeWithThis, baseWithThis)`: whether `heir` fits `base` with `this`, the `this` type of the heir, for
    /// `this` in both. `None` if it does, else the two as they were compared.
    fn heir_against_base(
        &mut self,
        heir: TypeId,
        base: TypeId,
        this: TypeId,
    ) -> Option<(TypeId, TypeId)> {
        // As the two stand each is `this` to itself. What fits so is taken to fit.
        if self.is_assignable(heir, base) {
            return None;
        }
        let with_this = (
            self.with_this_argument(heir, this),
            self.with_this_argument(base, this),
        );
        if !self.is_assignable(with_this.0, with_this.1) {
            return Some(with_this);
        }
        // `isObjectTypeWithInferableIndex`: what a class or an interface declares is not taken for an index signature it lacks.
        // The two that were compared are nobody's declaration, so that is asked of the types themselves.
        let (Some(sm), Some(tm)) = (self.members(heir), self.members(base)) else {
            return None;
        };
        let has_string_index = tm
            .shape()
            .index
            .iter()
            .any(|info| info.key == TypeId::STRING);
        for info in &tm.shape().index {
            let wanted = self.instantiate(info.value, tm.mapper);
            if !(has_string_index && self.is_any(wanted))
                && self.applicable_index_info(&sm, info.key, None).is_none()
            {
                return Some(with_this);
            }
        }
        None
    }

    /// `issueMemberSpecificError`: it is said of each member that is to blame, and of the class if none can be told. `plain`: the
    /// class and what it does not fit. `with_this`: what `heir_against_base` made of the two. As there, what fits either way fits.
    fn issue_member_specific_error(
        &mut self,
        file: FileId,
        c: ClassId,
        plain: (TypeId, TypeId),
        with_this: (TypeId, TypeId),
        broad: u32,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let apparent_base = self.apparent_type(with_this.1);
        let mut named: Vec<(MemberId, Atom)> = Vec::new();
        for m in hir[c].members.iter() {
            let member = &hir[m];
            if member.flags.contains(Flags::STATIC)
                || !matches!(
                    member.kind,
                    MemberKind::Property
                        | MemberKind::Method
                        | MemberKind::Getter
                        | MemberKind::Setter
                )
            {
                continue;
            }
            if let Some(name) = self.member_name(file, member.key) {
                named.push((m, name));
            }
        }
        // What fits as the two stand is let off, unless that leaves no member to blame.
        let mut some_fit_neither_way = false;
        for &(_, name) in &named {
            some_fit_neither_way |= !self.is_member_assignable(with_this, name)
                && !self.is_member_assignable(plain, name);
        }
        let mut issued = false;
        for (m, name) in named {
            let member = &hir[m];
            if !self.is_member_assignable(with_this, name)
                && !(some_fit_neither_way && self.is_member_assignable(plain, name))
            {
                out.push(Diagnostic {
                    start: member.pos,
                    code: 2416,
                });
                let end = self.end_of_member_name(file, m);
                self.explain_another(member.pos, end, 2416, |c| {
                    let declared = match c.prop_of(plain.0, name) {
                        Some((prop, _)) => c.prop_to_string(&prop),
                        None => c.atom_text(name),
                    };
                    vec![
                        declared,
                        c.type_to_string(plain.0),
                        c.base_with_this_to_string(plain.1),
                    ]
                });
                if self.explains
                    && let (Some((own, own_mapper)), Some((inherited, base_mapper))) = (
                        self.prop_of(with_this.0, name),
                        self.prop_of(apparent_base, name),
                    )
                {
                    let (given, wanted) = (
                        self.type_of_prop(&own, own_mapper),
                        self.type_of_prop(&inherited, base_mapper),
                    );
                    let (lines, related) = self.relation_lines_with_related(
                        given,
                        wanted,
                        super::relate::Relation::Assignable,
                        None,
                        1,
                    );
                    self.explain_chain(member.pos, 2416, |_| lines);
                    self.relate(member.pos, 2416, |_| related);
                }
                issued = true;
            }
        }
        if !issued {
            let at = if hir[c].name.is_some() {
                hir[c].name_pos
            } else {
                hir[c].pos
            };
            self.report_not_assignable(plain.0, plain.1, at, broad, out);
            self.explain_as_another(at);
            self.explain_base_with_this(at, broad, plain.1);
        }
    }

    /// `typeToString(baseWithThis)`: a reference or an intersection that `getTypeWithThisArgument` makes anew goes by no alias.
    fn base_with_this_to_string(&mut self, base: TypeId) -> String {
        let base = self.without_alias_of_reference(base);
        if self.is_intersection(base) && self.takes_this_argument(base) {
            self.type_to_string_written_out(base)
        } else {
            self.type_to_string(base)
        }
    }

    /// Has what was last noted of the error `code` at `start` name `base` as `base_with_this_to_string` does.
    fn explain_base_with_this(&mut self, start: u32, code: u32, base: TypeId) {
        if !self.explains
            || !self.is_intersection(base) && self.without_alias_of_reference(base) == base
        {
            return;
        }
        let (plain, with_this) = (
            self.type_to_string(base),
            self.base_with_this_to_string(base),
        );
        self.explain_renamed(start, code, &plain, &with_this);
    }

    /// Whether the property `name` of the first of `pair` fits that of the second. It does where one of them has none, and where it
    /// cannot be told.
    fn is_member_assignable(&mut self, pair: (TypeId, TypeId), name: Atom) -> bool {
        let base = self.apparent_type(pair.1);
        let (Some((own, own_mapper)), Some((inherited, base_mapper))) =
            (self.prop_of(pair.0, name), self.prop_of(base, name))
        else {
            return true;
        };
        let (given, wanted) = (
            self.type_of_prop(&own, own_mapper),
            self.type_of_prop(&inherited, base_mapper),
        );
        !self.is_known(given) || !self.is_known(wanted) || self.is_assignable(given, wanted)
    }

    /// The members that declare `prop`, if members of classes or interfaces do.
    fn declarations_of_prop<'a>(&self, prop: &'a Prop) -> &'a [(FileId, MemberId)] {
        match &prop.source {
            PropSource::Members(members) => members,
            _ => &[],
        }
    }

    /// What `checkKindsOfPropertyMemberOverrides` asks of the symbol of a property: whether it is a property, has a getter, has a
    /// setter, is a method. `None`: what declares it does not tell.
    fn kinds_of_prop(&self, prop: &Prop) -> Option<(bool, bool, bool, bool)> {
        match &prop.source {
            PropSource::Members(decls) if !decls.is_empty() => {
                let (mut property, mut getter, mut setter, mut method) =
                    (false, false, false, false);
                for &(f, m) in decls.iter() {
                    let member = &self.hir(f)[m];
                    match member.kind {
                        MemberKind::Property if member.flags.contains(Flags::ACCESSOR) => {
                            (getter, setter) = (true, true)
                        }
                        MemberKind::Property => property = true,
                        MemberKind::Getter => getter = true,
                        MemberKind::Setter => setter = true,
                        MemberKind::Method => method = true,
                        _ => {}
                    }
                }
                Some((property, getter, setter, method))
            }
            // A parameter that declares a property.
            PropSource::Parameter(..) => Some((true, false, false, false)),
            // `createUnionOrIntersectionProperty`: accessors if all the members of the intersection have the same ones, else a property.
            // A method besides (`CheckFlagsSyntheticMethod`) if it is one in all of them.
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

    /// Whether an interface declares `prop`, or one of the properties an intersection makes it of.
    fn is_declared_in_interface(&self, prop: &Prop) -> bool {
        match &prop.source {
            PropSource::Members(decls) => decls.iter().any(|&(f, m)| {
                matches!(
                    self.bound(f).member_owner[m.idx()],
                    MemberOwner::Interface(_)
                )
            }),
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
        out: &mut Vec<Diagnostic>,
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
            let is_abstract = base_decls
                .iter()
                .any(|&(f, m)| self.hir(f)[m].flags.contains(Flags::ABSTRACT));
            if derived.source == inherited.source {
                // Taken over as it is. What is abstract has to be filled in, unless the class is abstract as well.
                if is_abstract && !is_abstract_class {
                    let elsewhere = self.base_types(sym).iter().any(|&other| {
                        other != base
                            && self
                                .prop_of(other, inherited.name)
                                .is_some_and(|(p, _)| p.source != inherited.source)
                    });
                    if !elsewhere {
                        not_implemented += 1;
                        missed.push(inherited);
                    }
                }
                continue;
            }
            // `getDeclarationModifierFlagsFromSymbol`: what several members of an intersection have is private if it is in one of them.
            let is_private_somewhere = matches!(&inherited.source, PropSource::Intersected(_, parts) if parts.iter().any(|part| part.flags.contains(PropFlags::PRIVATE)));
            if (inherited.flags | derived.flags).contains(PropFlags::PRIVATE)
                || is_private_somewhere
            {
                continue;
            }
            // The name of `derived.ValueDeclaration`.
            let (derived_file, start) = match &derived.source {
                PropSource::Members(decls) => {
                    let Some(&(f, first)) = decls.first() else {
                        continue;
                    };
                    (f, self.hir(f)[first].pos)
                }
                PropSource::Parameter(f, p) => (*f, self.hir(*f)[self.hir(*f)[*p].pat].pos),
                _ => continue,
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
                // `arePropertiesAbstractOrInterface`: all the declarations, or one of those an intersection puts together.
                let is_abstract_or_interface = match &inherited.source {
                    PropSource::Intersected(..) => self.is_declared_in_interface(inherited),
                    _ => {
                        !base_decls.is_empty()
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
                    out.push(Diagnostic { start, code: 2610 });
                    self.explain_override(file, start, 2610, inherited, base, class_type);
                } else if base_property && !base_accessor && derived_accessor {
                    out.push(Diagnostic { start, code: 2611 });
                    self.explain_override(file, start, 2611, inherited, base, class_type);
                } else if self.p.files.options.use_define_for_class_fields
                    && !is_abstract
                    && self.is_redefined_without_initializer(file, c, derived, class_type)
                {
                    out.push(Diagnostic { start, code: 2612 });
                    let end = self.end_of_name_at(file, start);
                    self.explain_to(start, end, 2612, |c| {
                        vec![c.prop_to_string(inherited), c.type_to_string(base)]
                    });
                }
            } else if base_method {
                if !(derived_method || derived_property) {
                    out.push(Diagnostic { start, code: 2423 });
                    self.explain_override(file, start, 2423, inherited, base, class_type);
                }
            } else if base_accessor {
                out.push(Diagnostic { start, code: 2426 });
                self.explain_override(file, start, 2426, inherited, base, class_type);
            } else {
                out.push(Diagnostic { start, code: 2425 });
                self.explain_override(file, start, 2425, inherited, base, class_type);
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
            let start = if hir[c].name.is_some() {
                hir[c].name_pos
            } else {
                hir[c].pos
            };
            out.push(Diagnostic { start, code });
            self.explain(start, code, |c| {
                let names: Vec<String> = missed.iter().map(|prop| c.prop_to_string(prop)).collect();
                let listed = if names.len() > 5 { 4 } else { names.len() };
                let list = match &names[..] {
                    [only] => only.clone(),
                    _ => names[..listed]
                        .iter()
                        .map(|name| format!("'{name}'"))
                        .collect::<Vec<_>>()
                        .join(", "),
                };
                let mut args = Vec::new();
                if !is_expression {
                    args.push(c.type_to_string(class_type));
                }
                let base_name = c.type_to_string(base);
                if names.len() == 1 {
                    args.extend([list, base_name]);
                } else {
                    args.extend([base_name, list]);
                }
                if names.len() > 5 {
                    args.push((names.len() - 4).to_string());
                }
                args
            });
        }
    }

    /// The end of `checkKindsOfPropertyMemberOverrides`, under `useDefineForClassFields`: whether a declaration of `derived` in the
    /// class `c` has no initializer, so that it defines the property anew, and the constructor does not assign to it either.
    fn is_redefined_without_initializer(
        &mut self,
        file: FileId,
        c: ClassId,
        derived: &Prop,
        class_type: TypeId,
    ) -> bool {
        let hir = self.hir(file);
        let PropSource::Members(decls) = &derived.source else {
            return false;
        };
        if hir.kind == FileKind::Declaration
            || hir[c].flags.contains(Flags::AMBIENT)
            || decls.iter().any(|&(f, m)| {
                let member = &self.hir(f)[m];
                // `SymbolFlagsTransient`: `lateBindMember` made the symbol.
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
            && self.hir(of).text.get(member.pos as usize) != Some(&b'[');
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

    /// The arguments of what `checkKindsOfPropertyMemberOverrides` says at the name of a member that overrides `inherited`.
    fn explain_override(
        &mut self,
        file: FileId,
        start: u32,
        code: u32,
        inherited: &Prop,
        base: TypeId,
        heir: TypeId,
    ) {
        let end = self.end_of_name_at(file, start);
        self.explain_to(start, end, code, |c| {
            let name = c.prop_to_string(inherited);
            let (base, heir) = (c.type_to_string(base), c.type_to_string(heir));
            if matches!(code, 2610 | 2611) {
                vec![name, base, heir]
            } else {
                vec![base, name, heir]
            }
        });
    }

    fn check_interface_heritage(
        &mut self,
        file: FileId,
        i: InterfaceId,
        out: &mut Vec<Diagnostic>,
    ) {
        let sym = self
            .files()
            .sym(file, self.bound(file).interface_symbol[i.idx()]);
        let decls = self.files().decls_of(sym);
        // `interfaceChecked`: once for the interface, at the first of its declarations that is checked.
        let first = decls.iter().find_map(|&(f, d)| match d {
            Decl::Interface(id) if self.reports_semantic_errors(f) => Some((f, id)),
            _ => None,
        });
        let is_first = first == Some((file, i));
        let ty = self.declared_type(sym);
        if !self.is_known(ty) {
            return;
        }
        let name_pos = self.hir(file)[i].name_pos;
        let bases = self.base_types(sym);
        if is_first {
            let at = self.place_of_token(file, name_pos);
            if !self.check_inherited_properties_are_identical(sym, ty, &bases, Some(at)) {
                return;
            }
            let this = self.intern(TypeData::ThisParam(sym));
            for &base in bases.iter() {
                // `resolveBaseTypesOfInterface`: what cannot be extended is no base type.
                if !self.is_known(base) || !self.is_valid_base_type(base) {
                    continue;
                }
                // `getTypeWithThisArgument` gives back what is no reference. To tell costs (`isThislessInterface`), and whether the two are
                // related does not hang on it: it is asked once they are not.
                let mut with_this = [ty, base].map(|t| self.type_with_this_argument(t, this));
                let [source, target] = with_this;
                if self.is_type_related_to_if_told(source, target, Relation::Assignable, true)
                    == Some(true)
                {
                    continue;
                }
                for (t, plain) in with_this.iter_mut().zip([ty, base]) {
                    if !self.takes_this_argument(plain) {
                        *t = plain;
                    }
                }
                let [type_with_this, base_with_this] = with_this;
                self.check_type_assignable_to(type_with_this, base_with_this, Some(at), Some(2430));
            }
        } else if !self.check_inherited_properties_are_identical(sym, ty, &bases, None) {
            return;
        }
        let mut locals: SmallVec<[(FileId, Span<MemberId>); 2]> = SmallVec::new();
        for &(f, d) in decls.iter() {
            match d {
                Decl::Interface(id) => locals.push((f, self.hir(f)[id].members)),
                Decl::Class(c) => locals.push((f, self.hir(f)[c].members)),
                _ => {}
            }
        }
        // What is said where the interface is named is said once. Nothing is where a class goes by the name as well: the type is
        // that of the class then (`ObjectFlagsInterface`).
        let is_class = self.files().flags(sym).contains(SymFlags::CLASS);
        let fallback = first
            .filter(|&(f, _)| f == file && is_first && !is_class)
            .map(|_| (name_pos, sym));
        if is_first || first.is_some_and(|(f, _)| f != file) {
            self.check_index_constraints(file, ty, &locals, false, fallback, out);
        }
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
        // What it declares itself settles the matter.
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
        // Of what is private or protected, where it is declared as well.
        let mut seen: Vec<(Atom, TypeId, PropFlags, Option<PropSource>, TypeId)> = Vec::new();
        let mut identical = true;
        for &declared_base in bases {
            // `this` is in each what it is in the heir.
            let base = self.with_this_argument(declared_base, this);
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
                        prop.flags.intersects(access).then(|| prop.source.clone()),
                        declared_base,
                    )),
                    // `isPropertyIdenticalTo`, `compareProperties`
                    Some((_, other, flags, source, from)) => {
                        let (other, flags, from) = (*other, *flags, *from);
                        // What is not for all to see is the same only if it is declared in one place. Of the rest, whether it can be
                        // left out counts.
                        let same = if flags.intersects(access) {
                            PropFlags::READONLY
                        } else {
                            PropFlags::OPTIONAL | PropFlags::READONLY
                        };
                        if flags & access == prop.flags & access
                            && (!flags.intersects(access) || source.as_ref() == Some(&prop.source))
                            && flags & same == prop.flags & same
                            && (!self.is_known(prop_type)
                                || !self.is_known(other)
                                || self.is_identical(other, prop_type))
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
                        let args = [Arg::Text(&name), Arg::Text(&first), Arg::Text(&second)];
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

    /// `checkIndexConstraints`. `locals`: the members that the declarations of `ty` itself list. `fallback`: for an interface,
    /// where it is named, for a property and an index signature that come from different interfaces it extends.
    fn check_index_constraints(
        &mut self,
        file: FileId,
        ty: TypeId,
        locals: &[(FileId, Span<MemberId>)],
        is_static: bool,
        fallback: Option<(u32, Sym)>,
        out: &mut Vec<Diagnostic>,
    ) {
        let Some(members) = self.members(ty) else {
            return;
        };
        if members.shape().index.is_empty() {
            return;
        }
        let infos: Vec<IndexInfo> = members
            .shape()
            .index
            .iter()
            .map(|i| IndexInfo {
                value: self.instantiate(i.value, members.mapper),
                ..*i
            })
            .collect();
        // `localIndexDeclaration`
        let local_index = |c: &Self, info: &IndexInfo| -> Option<(FileId, u32, Reported)> {
            let (f, m) = info.declaration?;
            locals
                .iter()
                .any(|&(local, span)| local == f && span.range().contains(&m.idx()))
                .then(|| (f, c.hir(f)[m].pos, Reported::Member(m)))
        };
        for prop in &members.shape().props {
            let text = self.files().atoms.bytes(prop.name);
            if text.first() == Some(&b'#') || is_static && prop.name == known::prototype {
                continue;
            }
            let is_local = |f: FileId, m: MemberId| {
                locals
                    .iter()
                    .any(|&(lf, span)| lf == f && span.range().contains(&m.idx()))
            };
            let local_prop = match &prop.source {
                // An error about a parameter goes to where it starts, modifiers included (`GetErrorRangeForNode`).
                PropSource::Parameter(f, p) => {
                    let bound = self.bound(*f);
                    matches!(bound.fns[bound.param_fn[p.idx()].idx()].owner, FnOwner::Member(m) if is_local(*f, m)).then(|| (*f, self.hir(*f)[*p].pos, Reported::Param(*p)))
                }
                _ => self
                    .declarations_of_prop(prop)
                    .iter()
                    .find(|&&(f, m)| is_local(f, m))
                    .map(|&(f, m)| (f, self.hir(f)[m].pos, Reported::Member(m))),
            };
            let prop_type = self.type_of_prop_as_read(prop, members.mapper);
            if !self.is_known(prop_type) {
                continue;
            }
            for info in &infos {
                if !self.is_name_applicable_to_index(prop.name, info.key)
                    || !self.is_known(info.value)
                {
                    continue;
                }
                let mut at = local_prop.or_else(|| local_index(self, info));
                if at.is_none()
                    && let Some((name_pos, sym)) = fallback
                {
                    let has_both = self.base_types(sym).iter().any(|&base| {
                        self.prop_of(base, prop.name).is_some()
                            && self
                                .members(base)
                                .is_some_and(|m| m.shape().index.iter().any(|i| i.key == info.key))
                    });
                    if !has_both {
                        at = Some((file, name_pos, Reported::Name));
                    }
                }
                if let Some((f, start, node)) = at
                    && f == file
                    && !self.is_assignable(prop_type, info.value)
                {
                    out.push(Diagnostic { start, code: 2411 });
                    let end = self.end_of_reported(file, node);
                    self.explain_another(start, end, 2411, |c| {
                        vec![
                            c.prop_to_string(prop),
                            c.type_to_string(prop_type),
                            c.type_to_string(info.key),
                            c.type_to_string(info.value),
                        ]
                    });
                    // `propDeclaration`
                    if local_prop.is_none()
                        && let Some(&(of, m)) = self.declarations_of_prop(prop).first()
                    {
                        let (text, member) = (&self.hir(of).text, &self.hir(of)[m]);
                        if matches!(member.key, PropKey::Computed(_))
                            || text.get(member.pos as usize) == Some(&b'[')
                        {
                            self.relate(start, 2411, |c| {
                                let place = if text.is_empty() {
                                    c.place_of_token(of, member.pos)
                                } else {
                                    let (from, to) = c.error_range_of_member(of, m);
                                    (of, from, to)
                                };
                                let name = c.prop_to_string(prop);
                                vec![c.declared_here(place, name)]
                            });
                        }
                    }
                }
            }
        }
        // The members of a class whose names are only known when it runs (`hasBindableName`): each is a property of its own.
        for &(f, span) in locals {
            if f != file {
                continue;
            }
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
                let name_type = self.type_of_expr(f, key);
                let flags = if member.flags.contains(Flags::OPTIONAL) {
                    PropFlags::OPTIONAL
                } else {
                    PropFlags::empty()
                };
                let prop = Prop {
                    name: Atom::NONE,
                    flags,
                    source: PropSource::Members(MemberList::One((f, m))),
                    mapper: MapperId::IDENTITY,
                };
                let prop_type = self.type_of_prop_as_read(&prop, members.mapper);
                if !self.is_known(name_type) || !self.is_known(prop_type) {
                    continue;
                }
                for info in &infos {
                    if self.is_known(info.value)
                        && self.is_index_key_applicable(name_type, info.key)
                        && !self.is_assignable(prop_type, info.value)
                    {
                        out.push(Diagnostic {
                            start: member.pos,
                            code: 2411,
                        });
                        let end = self.end_of_member_name(f, m);
                        self.explain_another(member.pos, end, 2411, |c| {
                            vec![
                                c.source_text(f, member.pos, end),
                                c.type_to_string(prop_type),
                                c.type_to_string(info.key),
                                c.type_to_string(info.value),
                            ]
                        });
                    }
                }
            }
        }
        // `checkIndexConstraintForIndexSignature`
        if infos.len() > 1 {
            for check in &infos {
                for info in &infos {
                    if info.key == check.key || !self.is_index_key_applicable(check.key, info.key) {
                        continue;
                    }
                    let mut at = local_index(self, check).or_else(|| local_index(self, info));
                    if at.is_none()
                        && let Some((name_pos, sym)) = fallback
                    {
                        let has_both = self.base_types(sym).iter().any(|&base| {
                            self.members(base).is_some_and(|m| {
                                let index = &m.shape().index;
                                index.iter().any(|i| i.key == check.key)
                                    && index.iter().any(|i| i.key == info.key)
                            })
                        });
                        if !has_both {
                            at = Some((file, name_pos, Reported::Name));
                        }
                    }
                    if let Some((f, start, node)) = at
                        && f == file
                        && self.is_known(check.value)
                        && self.is_known(info.value)
                        && !self.is_assignable(check.value, info.value)
                    {
                        out.push(Diagnostic { start, code: 2413 });
                        let end = self.end_of_reported(file, node);
                        self.explain_another(start, end, 2413, |c| {
                            vec![
                                c.type_to_string(check.key),
                                c.type_to_string(check.value),
                                c.type_to_string(info.key),
                                c.type_to_string(info.value),
                            ]
                        });
                    }
                }
            }
        }
    }

    fn end_of_reported(&self, file: FileId, node: Reported) -> u32 {
        match node {
            Reported::Member(m) => self.error_end_of_member(file, m),
            Reported::Param(p) => self.end_of_param(file, p),
            Reported::Name => 0,
        }
    }

    /// The end of `GetErrorRangeForNode` of a member: that of its name. A signature in a type that is no property is reported on as
    /// a whole.
    pub(super) fn error_end_of_member(&self, file: FileId, m: MemberId) -> u32 {
        let is_in_class = matches!(
            self.bound(file).member_owner[m.idx()],
            MemberOwner::Class(_)
        );
        match self.hir(file)[m].kind {
            MemberKind::Property | MemberKind::Getter | MemberKind::Setter => {
                self.end_of_member_name(file, m)
            }
            MemberKind::Method if is_in_class => self.end_of_member_name(file, m),
            _ => self.hir(file)[m].loc.end,
        }
    }

    /// `isApplicableIndexType`
    fn is_index_key_applicable(&mut self, source: TypeId, target: TypeId) -> bool {
        self.is_assignable(source, target)
            || target == TypeId::STRING && self.is_assignable(source, TypeId::NUMBER)
            || target == TypeId::NUMBER
                && match self.data(source) {
                    // `${number}`
                    TypeData::Template { texts, types } => {
                        types[..] == [TypeId::NUMBER]
                            && texts
                                .iter()
                                .all(|&text| self.files().atoms.bytes(text).is_empty())
                    }
                    TypeData::StringLit { value, .. }
                    | TypeData::EnumLit {
                        value: EnumValue::String(value),
                        ..
                    } => self.is_numeric_name(*value),
                    _ => false,
                }
    }
}
