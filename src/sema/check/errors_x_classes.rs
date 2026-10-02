//! Classes and interfaces against what they extend, and what only the inside of a class can get wrong:
//! 4112 4113 4114 4115 4116 4117 4127 (`override`), 4119 to 4123 4128 (`override` in a JavaScript file); 2510 2545 2797
//! 2675 (what a class extends); 2422 (what it implements); 2499 (what an interface extends); 2725 (a class called `Object`);
//! 2376 2377 2401 17005 (where `super()` is called); 2715 (an abstract property read while the instance is set up).
//!
//! Follows `checkClassLikeDeclaration`, `checkBaseTypeAccessibility`, `checkMembersForOverrideModifier`,
//! `checkMemberForOverrideModifier`, `isValidBaseType`, `checkInterfaceDeclaration`, `checkClassNameCollisionWithObject`,
//! `checkConstructorDeclaration` and `checkPropertyAccessibilityAtLocation` of TypeScript 7.0.2's checker.go.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{FnOwner, MemberOwner, Parent};
use crate::resolve::ModuleKind;
use smallvec::SmallVec;

/// What `getBaseConstructorTypeOfClass` and `getBaseTypes` come to for a class with an `extends` clause.
#[derive(Copy, Clone)]
enum ClassBase {
    /// It cannot be told.
    Unknown,
    /// It has no `extends` clause, or no base types.
    Nothing,
    /// `constructor`: the type of what is written after `extends`. `base`: the first of its base types.
    Is { constructor: TypeId, base: TypeId },
}

/// What `checkMemberForOverrideModifier` is given: a member of a class, or a parameter that declares a property.
#[derive(Copy, Clone)]
struct Overrider {
    key: PropKey,
    flags: Flags,
    /// The member, or the constructor that has the parameter.
    member: MemberId,
    /// `NONE` for a member.
    param: ParamId,
}

/// The modifier that ends right before `pos`, and its start. Whitespace and `/* .. */` comments in between are skipped.
fn modifier_before(text: &[u8], pos: u32) -> Option<(u32, &[u8])> {
    let mut before = text.get(..pos as usize)?.trim_ascii_end();
    // `public /* .. */ constructor`
    while before.ends_with(b"*/")
        && let Some(open) = before[..before.len() - 2]
            .windows(2)
            .rposition(|w| w == b"/*")
    {
        before = before[..open].trim_ascii_end();
    }
    let word = before
        .iter()
        .rposition(|b| !b.is_ascii_alphabetic())
        .map_or(0, |i| i + 1);
    let is_modifier = matches!(
        &before[word..],
        b"public"
            | b"private"
            | b"protected"
            | b"static"
            | b"readonly"
            | b"abstract"
            | b"declare"
            | b"override"
            | b"async"
            | b"accessor"
    );
    // Not the end of a longer name, nor the name of a property.
    if !is_modifier
        || word > 0
            && matches!(before[word - 1], b'_' | b'$' | b'.' | b'#' | b'0'..=b'9' | 0x80..=0xff)
    {
        return None;
    }
    // `nextTokenCanFollowModifier`: but for `static`, a word only modifies what follows it on the same line.
    if &before[word..] != b"static" && text[before.len()..pos as usize].contains(&b'\n') {
        return None;
    }
    // Not the last word of a `//` comment.
    let line = before[..word]
        .iter()
        .rposition(|&b| b == b'\n')
        .map_or(0, |i| i + 1);
    if before[line..word].windows(2).any(|w| w == b"//") {
        return None;
    }
    Some((word as u32, &before[word..]))
}

/// Whether `declare` is one of the modifiers before the member name at `pos`.
fn has_declare_modifier(text: &[u8], mut pos: u32) -> bool {
    while let Some((start, modifier)) = modifier_before(text, pos) {
        if modifier == b"declare" {
            return true;
        }
        pos = start;
    }
    false
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

impl Checker<'_> {
    pub(super) fn check_x_classes(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // Of a file that could not be made sense of only parts are there: what is missing from them may well be written.
        if hir.has_errors {
            return;
        }
        for i in 0..hir.interfaces.len() {
            if bound.interface_symbol[i].is_some() {
                self.check_bases_of_interface(file, InterfaceId(i as u32), out);
            }
        }
        // `checkClassLikeDeclaration`: 2500 is said when the tree is made.
        for &(start, code) in hir.checker_errors.iter() {
            if code == 2500 {
                let end = self.end_of_heritage_expression(file, start);
                self.note(start, end, 2500, Vec::new());
            }
        }
        self.check_super_call_placement(file, out);
        // The rest is about `this`.
        let index = self.exprs_by_kind(file);
        if index.of(ExprTag::This).is_empty() {
            return;
        }
        self.check_abstract_properties_in_constructors(file, &index, out);
    }

    // ───────────────────────────── what a class extends and implements ─────────────────────────────

    /// `checkClassLikeDeclaration`, from `baseTypeNode` to the `implements` clauses, and `checkClassNameCollisionWithObject`.
    pub(super) fn report_class_like_declaration(&mut self, file: FileId, c: ClassId, sym: Sym) {
        let hir = self.hir(file);
        // Of a file that could not be made sense of only parts are there: what is missing from them may well be written.
        if hir.has_errors {
            return;
        }
        let class = &hir[c];
        if class.name == known::Object
            && !class.flags.contains(Flags::AMBIENT)
            && self.emits_module_format_before_es2015(file)
        {
            let module = self.p.files.options.module.name();
            let at = self.place_of_token(file, class.name_pos);
            self.error(at, 2725, &[Arg::Text(module)]);
        }
        let base = self.base_of_class(file, c, sym);
        if let ClassBase::Is { constructor, base } = base {
            let static_base_type = self.apparent_type(constructor);
            self.check_base_type_accessibility(file, c, static_base_type);
            if self.is_type_variable(constructor) {
                let static_type = self.type_of_symbol(sym);
                let own = self.signatures(static_type, true);
                // `GetErrorRangeForNode`
                let at = self.place_of_token(file, class.name_pos);
                if !self.is_mixin_constructor_type(&own) {
                    self.error(at, 2545, &[]);
                } else if !class.flags.contains(Flags::ABSTRACT)
                    && self
                        .signatures(constructor, true)
                        .iter()
                        .any(|&sig| self.is_abstract_signature(sig))
                {
                    self.error(at, 2797, &[]);
                }
            } else if !matches!(
                self.data(static_base_type),
                TypeData::Anon {
                    origin: Origin::ClassStatic(_),
                    ..
                }
            ) {
                // What is like a class without being one has to make the same thing whichever way it is called.
                let mut returns = Vec::new();
                for sig in self.super_constructor_sigs(sym) {
                    returns.push(self.sig_return(sig));
                }
                let are_known = returns.iter().all(|&returned| self.is_known(returned));
                let all_the_same = self.answer_if_sure(|checker| {
                    returns
                        .iter()
                        .all(|&returned| checker.is_identical(returned, base))
                });
                if are_known
                    && all_the_same == Some(false)
                    && let Some(at) = self.place_to_report_base_at(file, c)
                {
                    self.error(at, 2510, &[]);
                }
            }
        }
        self.check_members_for_override_modifier(file, c, sym, base);
        for node in hir.ids(class.implements) {
            // The name of a primitive type is a name that nothing goes by here, which is said elsewhere.
            if !matches!(hir[node].kind, TypeNodeKind::Ref { .. }) {
                continue;
            }
            let implemented = self.type_from_node(file, node);
            let implemented = self.reduced_base_type(implemented);
            if self.is_settled_base(implemented) && !self.is_valid_base_type(implemented) {
                let at = (file, hir[node].pos, self.end_of_type_node(file, node));
                self.error(at, 2422, &[]);
            }
        }
    }

    /// Whether `GetEmitModuleFormatOfFile` gives something older than ES2015: CommonJS, AMD, UMD or System.
    fn emits_module_format_before_es2015(&self, file: FileId) -> bool {
        let module = self.files().module(file);
        let kind = self.p.files.options.module;
        // `GetImpliedNodeFormatForEmitWorker`
        if kind.is_node() {
            return !module.is_esm;
        }
        let path = module.path.as_str();
        if path.ends_with(".cts") || path.ends_with(".cjs") {
            return true;
        }
        // Of what `package.json` says, only `"type": "module"` is kept.
        if module.says_esm || path.ends_with(".mts") || path.ends_with(".mjs") {
            return false;
        }
        kind < ModuleKind::Es2015
    }

    /// `getBaseConstructorTypeOfClass` and `getBaseTypes(classType)[0]`, of the class `c` of `sym`.
    fn base_of_class(&mut self, file: FileId, c: ClassId, sym: Sym) -> ClassBase {
        let class = &self.hir(file)[c];
        if class.extends.is_none() {
            return ClassBase::Nothing;
        }
        let constructor = self.base_constructor_type_of_class(sym);
        if !self.is_error_type(constructor) && (!self.is_known(constructor)) {
            return ClassBase::Unknown;
        }
        if let Some(&base) = self.base_types(sym).first() {
            return ClassBase::Is { constructor, base };
        }
        // No base type is made of what could not be worked out.
        let args = self.types_from_nodes(file, class.extends_args);
        let returned = match self.super_constructor_sigs(sym).first() {
            Some(&sig) => self.sig_return(sig),
            None => TypeId::ERROR,
        };
        if args.iter().all(|&arg| self.is_known(arg))
            && (self.is_error_type(returned) || self.is_settled_base(returned))
        {
            ClassBase::Nothing
        } else {
            ClassBase::Unknown
        }
    }

    /// `checkBaseTypeAccessibility`: 2675, only from within a class can what it makes privately be extended.
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
        // `getDefaultConstructSignatures`: a class without a constructor is made by that of what it extends, which stays private.
        let (mut sig, mut steps) = (first, 0);
        let (declared_in, func) = loop {
            match *self.p.types.sig(sig) {
                SigData::Construct { file, func, .. } => break (file, func),
                SigData::DefaultConstruct {
                    class: of, base, ..
                } => {
                    if steps == 32 || self.base_types(of).is_empty() {
                        return;
                    }
                    let Some(inherited) = base else {
                        return;
                    };
                    sig = inherited;
                    steps += 1;
                }
                _ => return,
            }
        };
        if !self.hir(declared_in)[func].flags.contains(Flags::PRIVATE) {
            return;
        }
        let extends = self.hir(file)[c].extends;
        let is_within = self
            .enclosing_classes(file, extends)
            .into_iter()
            .any(|around| self.class_sym(file, around) == class);
        if !is_within {
            let start = self.start_of(file, extends);
            // The type arguments are part of what is extended.
            let last_argument = self.end_of_type_args(file, self.hir(file)[c].extends_args);
            let end = if last_argument == 0 {
                self.end_of_expr(file, extends)
            } else {
                let rest = self.hir(file).text.get(last_argument as usize..);
                let close = rest.and_then(|rest| rest.iter().position(|&b| b == b'>'));
                last_argument + close.map_or(0, |at| at as u32 + 1)
            };
            let name = super::errors_modules::fully_qualified_name(self, class);
            self.error((file, start, end), 2675, &[Arg::Text(&name)]);
        }
    }

    /// Whether `ty` was worked out for good: all of it is known, and it does not wait for type parameters that are not there.
    pub(super) fn is_settled_base(&self, ty: TypeId) -> bool {
        self.is_known(ty) && (self.has_type_variables(ty) || !self.is_deferred(ty))
    }

    /// `isValidBaseType`: `any`, an object type whose members can be told, or an intersection of such. What is not known passes.
    pub(super) fn is_valid_base_type(&mut self, ty: TypeId) -> bool {
        if !self.is_known(ty) {
            return true;
        }
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

    /// `isGenericMappedType`: what it maps over is not known yet, or what it renames that to.
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

    /// `getReducedType`, with `isConflictingPrivateProperty` seen to: nothing can be an intersection in which a property is private
    /// to one member and declared anew by another.
    fn reduced_base_type(&mut self, ty: TypeId) -> TypeId {
        let ty = self.reduced(ty);
        if self.is_intersection(ty)
            && let Some(members) = self.members(ty)
        {
            for prop in &members.shape().props {
                if let PropSource::Intersected(_, parts) = &prop.source
                    && parts
                        .iter()
                        .any(|part| part.flags.contains(PropFlags::PRIVATE))
                    && Self::value_declaration(prop).is_none()
                {
                    return TypeId::NEVER;
                }
            }
        }
        ty
    }

    // ───────────────────────────── what an interface extends ─────────────────────────────

    /// `parseLeftHandSideExpressionOrHigher`: where the expression after `extends` or `implements` that starts at `start` ends. Of one
    /// that is no `A.B` only the start is kept.
    fn end_of_heritage_expression(&self, file: FileId, start: u32) -> u32 {
        let text = &self.hir(file).text;
        let mut end = match text.get(start as usize) {
            Some(b'(' | b'[' | b'{') => self.end_of_bracket_at(file, start),
            _ => self.end_of_token_at(file, start),
        };
        loop {
            let next = self.skip_trivia_from(file, end);
            end = match text.get(next as usize..) {
                Some([b'(' | b'[', ..]) => self.end_of_bracket_at(file, next),
                Some([b'?', b'.', ..]) => {
                    let after = self.skip_trivia_from(file, next + 2);
                    match text.get(after as usize) {
                        Some(b'(' | b'[') => self.end_of_bracket_at(file, after),
                        _ => self.end_of_token_at(file, after),
                    }
                }
                Some([b'.', ..]) => {
                    self.end_of_token_at(file, self.skip_trivia_from(file, next + 1))
                }
                Some([b'!', ..]) => next + 1,
                _ => return end,
            };
        }
    }

    /// The end of `checkInterfaceDeclaration`: 2499.
    fn check_bases_of_interface(
        &mut self,
        file: FileId,
        i: InterfaceId,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        for node in hir.ids(hir[i].extends) {
            // NEEDS: `parse_interface` to keep what is written after `extends` and is no `A.B.C<Args>` as a `TypeNodeKind::Error`
            // placed where it starts, where today it gives up on the whole interface.
            if matches!(
                hir[node].kind,
                TypeNodeKind::Error | TypeNodeKind::Heritage(_)
            ) {
                out.push(Diagnostic {
                    start: hir[node].pos,
                    code: 2499,
                });
                let end = self.end_of_heritage_expression(file, hir[node].pos);
                self.note(hir[node].pos, end, 2499, Vec::new());
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
        // Otherwise only what says `override` is looked at.
        let looks_at_all = self.p.files.options.no_implicit_override;
        for m in class.members.iter() {
            let member = &hir[m];
            if !looks_at_all
                && !member.flags.contains(Flags::OVERRIDE)
                && (member.kind != MemberKind::Constructor
                    || member.func.is_some()
                        && !hir[member.func]
                            .params
                            .iter()
                            .any(|p| hir[p].flags.contains(Flags::OVERRIDE)))
            {
                continue;
            }
            // `HasAmbientModifier`: `declare` is written on the member itself. Every member of an ambient class has
            // `Flags::AMBIENT`, so there the source text decides.
            if member.flags.contains(Flags::AMBIENT)
                && (!class.flags.contains(Flags::AMBIENT)
                    || has_declare_modifier(&hir.text, member.name_pos))
            {
                continue;
            }
            if member.kind != MemberKind::Constructor {
                let overrider = Overrider {
                    key: member.key,
                    flags: member.flags,
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
                    self.error(at, code(4112), &[Arg::Type(class_type)]);
                }
                return;
            }
            ClassBase::Is { constructor, base } => (constructor, base),
        };
        // A name that is only known when the program runs is the name of no property that could be looked up.
        if let PropKey::Computed(name) = member.key {
            match self.is_bindable_computed_name(file, name) {
                None => return,
                Some(false) => {
                    if has_override {
                        let at = self.place_of_overrider(file, member);
                        self.error(at, code(4127), &[]);
                    }
                    return;
                }
                Some(true) => {}
            }
        }
        if !has_override && !no_implicit_override {
            return;
        }
        let Some(name) = self.member_name(file, member.key) else {
            return;
        };
        let is_static = member.param.is_none() && member.flags.contains(Flags::STATIC);
        let this_type = if is_static {
            self.type_of_symbol(sym)
        } else {
            self.declared_type(sym)
        };
        if self.property_of_base(this_type, name).is_none() {
            return;
        }
        let base_type = if is_static { constructor } else { base };
        // `#x` of a class is not the `#x` of the class it extends.
        let base_prop = if matches!(member.key, PropKey::Private(_)) {
            None
        } else {
            self.property_of_base(base_type, name)
        };
        let Some(base_prop) = base_prop else {
            if has_override {
                let at = self.place_of_overrider(file, member);
                match self.suggested_member(base_type, name) {
                    Some(suggestion) => {
                        let suggestion = self.prop_to_string(&suggestion);
                        let args = [Arg::Type(base), Arg::Text(&suggestion)];
                        self.error(at, code(4117), &args);
                    }
                    None => {
                        self.error(at, code(4113), &[Arg::Type(base)]);
                    }
                }
            }
            return;
        };
        if has_override || self.hir(file)[c].flags.contains(Flags::AMBIENT) {
            return;
        }
        let Some((true, is_abstract)) = self.declarations_of_base_property(&base_prop) else {
            return;
        };
        let at = self.place_of_overrider(file, member);
        if !is_abstract {
            let must = if member.param.is_some() { 4115 } else { 4114 };
            self.error(at, code(must), &[Arg::Type(base)]);
        } else if member.flags.contains(Flags::ABSTRACT) {
            self.error(at, 4116, &[Arg::Type(base)]);
        }
    }

    /// `GetErrorRangeForNode`, of what `checkMemberForOverrideModifier` is given.
    fn place_of_overrider(&self, file: FileId, member: Overrider) -> (FileId, u32, u32) {
        if member.param.is_some() {
            let start = self.hir(file)[member.param].pos;
            return (file, start, self.end_of_param(file, member.param));
        }
        let (start, end) = self.error_range_of_member(file, member.member);
        (file, start, end)
    }

    /// Whether the computed name `e` comes to a name that is known beforehand: not `isNonBindableDynamicName`.
    /// `None`: it cannot be told.
    fn is_bindable_computed_name(&mut self, file: FileId, e: ExprId) -> Option<bool> {
        let hir = self.hir(file);
        if !is_dynamic_name(hir, e) {
            return Some(true);
        }
        // `isLateBindableAST`
        if !is_entity_name_expression(hir, e) {
            return Some(false);
        }
        let ty = self.type_of_expr(file, e);
        if !self.is_known(ty) {
            return None;
        }
        // `isValidESSymbolDeclaration`: `static readonly k = Symbol()` holds a symbol of its own, where here it is any symbol.
        if ty == TypeId::SYMBOL
            && let ExprKind::Dot { obj, name, .. } = hir[e].kind
        {
            let object = self.type_of_expr(file, obj);
            let apparent = self.apparent_type(object);
            if let Some((prop, _)) = self.prop_of(apparent, name)
                && let PropSource::Members(members) = &prop.source
                && members.iter().any(|&(f, m)| {
                    let member = &self.hir(f)[m];
                    member.ty.is_none() && member.flags.contains(Flags::STATIC | Flags::READONLY)
                })
            {
                return None;
            }
        }
        // `isTypeUsableAsPropertyName`
        Some(self.property_name_of_type(ty).is_some())
    }

    /// `getPropertyOfType`
    fn property_of_base(&mut self, ty: TypeId, name: Atom) -> Option<Prop> {
        let ty = self.reduced(ty);
        let apparent = self.apparent_type(ty);
        let members = self.members(apparent)?;
        self.property_of_type(&members, name).map(|(prop, _)| prop)
    }

    /// `getSuggestedSymbolForNonexistentClassMember`
    fn suggested_member(&mut self, ty: TypeId, name: Atom) -> Option<Prop> {
        // `ast.SymbolName`: a private name is compared as written.
        let written = self.written_name(name);
        // The name of a symbol-keyed member is compared like any other. In tsgo it is `\xFE@description@<symbol id>`
        // (`getESSymbolLikeTypeForNode`). `GetSymbolId` numbers symbols in the order they are first asked for, which cannot be
        // reproduced: the id is taken to have one digit, as it has early in a process.
        let late_bound = written
            .strip_prefix(crate::atom::SYMBOL_NAME_PREFIX)
            .map(|described| {
                let description = &described[..described
                    .iter()
                    .rposition(|&b| b == b'@')
                    .unwrap_or(described.len())];
                [crate::atom::SYMBOL_NAME_PREFIX, description, &b"@0"[..]].concat()
            });
        let text = late_bound.as_deref().unwrap_or(written);
        let ty = self.reduced(ty);
        let apparent = self.apparent_type(ty);
        let members = self.members(apparent)?;
        // `getCandidateName`: an internal name is never suggested, and only `SymbolFlagsClassMember` counts, which the exports of a
        // namespace merged with the class are not.
        let get_name = |prop: &Prop| match self.written_name(prop.name) {
            _ if matches!(prop.source, PropSource::Symbol(_)) => &[][..],
            name if name.starts_with(crate::atom::SYMBOL_NAME_PREFIX) => &[][..],
            name => name,
        };
        // Of two that are as close, the first.
        let compare = |_, _| std::cmp::Ordering::Equal;
        get_spelling_suggestion(text, members.shape().props.iter(), get_name, compare).cloned()
    }

    /// Whether `prop` has declarations at all, and whether one of them says `abstract`. `None`: where it comes from is not kept.
    fn declarations_of_base_property(&self, prop: &Prop) -> Option<(bool, bool)> {
        match &prop.source {
            PropSource::Members(members) => Some((
                !members.is_empty(),
                members
                    .iter()
                    .any(|&(f, m)| self.hir(f)[m].flags.contains(Flags::ABSTRACT)),
            )),
            PropSource::Parameter(..)
            | PropSource::Literal(..)
            | PropSource::Symbol(_)
            | PropSource::Assigned(..) => Some((true, false)),
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
            // The `prototype` of a class is made up.
            PropSource::Type(_) if prop.name == known::prototype => Some((false, false)),
            _ => None,
        }
    }

    // ───────────────────────────── where `super()` is called ─────────────────────────────

    /// The end of `checkConstructorDeclaration`: 2377 17005 2401 2376.
    /// Where fields are set up by assignments put in the constructor, they
    /// go right after the call of `super`, which therefore has to be a statement of the constructor itself, and the first
    /// that has to do with `this`.
    fn check_super_call_placement(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_super_call = |e: ExprId| matches!(hir[e].kind, ExprKind::Call(call) if matches!(hir[hir[call].callee].kind, ExprKind::Super));
        for f in 0..hir.fns.len() {
            let func = &hir.fns[f];
            let FnBody::Block(body) = func.body else {
                continue;
            };
            if func.kind != FnKind::Constructor {
                continue;
            }
            let FnOwner::Member(m) = bound.fns[f].owner else {
                continue;
            };
            let MemberOwner::Class(c) = bound.member_owner[m.idx()] else {
                continue;
            };
            if hir[c].extends.is_none() {
                continue;
            }
            let class_extends_null = self.class_declaration_extends_null(self.class_sym(file, c));
            // `findFirstSuperCall`
            let block = hir.node(FnId(f as u32)).with(Part::Body);
            let NodeData::Expr(first) = hir.data(self.find_first_super_call(hir, block)) else {
                if !class_extends_null {
                    // `GetErrorRangeForNode`: up to the keyword.
                    let end = self.end_of_name_at(file, hir[m].name_pos);
                    self.error((file, hir[m].start, end), 2377, &[]);
                }
                continue;
            };
            if class_extends_null && let ExprKind::Call(call) = hir[first].kind {
                let end = self.end_inside_parentheses(file, first);
                self.error((file, hir[hir[call].callee].pos, end), 17005, &[]);
            }
            if self.p.files.options.emit_standard_class_fields {
                continue;
            }
            // `isInstancePropertyWithInitializerOrPrivateIdentifierProperty`, or a parameter that declares a property.
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
                continue;
            }
            // `superCallIsRootLevelInConstructor`
            if !hir
                .ids(body)
                .any(|s| matches!(hir[s].kind, StmtKind::Expr(x) if x == first))
            {
                if let ExprKind::Call(call) = hir[first].kind {
                    out.push(Diagnostic {
                        start: hir[hir[call].callee].pos,
                        code: 2401,
                    });
                    let end = self.end_inside_parentheses(file, first);
                    self.note(hir[hir[call].callee].pos, end, 2401, Vec::new());
                }
                continue;
            }
            let mut is_first = false;
            for s in hir.ids(body) {
                if let StmtKind::Expr(mut x) = hir[s].kind {
                    // `SkipOuterExpressions`
                    while let ExprKind::As { expr: inner, .. }
                    | ExprKind::Satisfies { expr: inner, .. }
                    | ExprKind::AsConst(inner)
                    | ExprKind::NonNull(inner) = hir[x].kind
                    {
                        x = inner;
                    }
                    if is_super_call(x) {
                        is_first = true;
                        break;
                    }
                }
                if self.node_immediately_references_super_or_this(hir, hir.node(s)) {
                    break;
                }
            }
            if !is_first {
                let start = hir[m].start;
                out.push(Diagnostic { start, code: 2376 });
                // `GetErrorRangeForNode`: up to the keyword.
                self.note(
                    start,
                    self.end_of_name_at(file, hir[m].name_pos),
                    2376,
                    Vec::new(),
                );
            }
        }
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

    // ───────────────────────────── abstract properties while the instance is set up ─────────────────────────────

    /// 2715, of `checkPropertyAccessibilityAtLocation`: `this.p`, `const { p } = this` and `({ p } = this)` in a constructor or
    /// in the initializer of a property, where `p` is declared `abstract`: nothing has given it a value by then.
    fn check_abstract_properties_in_constructors(
        &mut self,
        file: FileId,
        index: &ExprsByKind,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_this =
            |e: ExprId| matches!(hir[e].kind, ExprKind::This) && !is_parenthesized(hir, e);
        let mut looked_at: SmallVec<[ExprId; 16]> = SmallVec::new();
        // `isThisProperty`
        for &e in index.of(ExprTag::Dot) {
            if let ExprKind::Dot { obj, .. } = hir[e].kind
                && is_this(obj)
                && !bound.is_unchecked(e.idx())
                && !bound.is_in_type_query(e)
                && self.is_used_during_class_initialization(file, bound.expr_parent[e.idx()])
            {
                looked_at.push(e);
            }
        }
        // `isThisInitializedObjectBindingExpression`
        for &e in index.of(ExprTag::Assign) {
            if let ExprKind::Assign {
                op: None,
                target,
                value,
            } = hir[e].kind
                && is_this(value)
                && !bound.is_unchecked(e.idx())
                && matches!(hir[target].kind, ExprKind::Object(_))
                && !is_parenthesized(hir, target)
                && self.is_used_during_class_initialization(file, bound.expr_parent[e.idx()])
            {
                looked_at.push(e);
            }
        }
        // In the order they have in the file, whichever of the two they are.
        looked_at.sort_unstable();
        for e in looked_at {
            let parent = bound.expr_parent[e.idx()];
            match hir[e].kind {
                ExprKind::Dot {
                    obj,
                    name,
                    name_pos,
                    ..
                } => {
                    // `IsWriteAccess`
                    let is_written = self.is_assignment_target(file, e)
                        || matches!(parent, Parent::Expr(p) if match hir[p].kind {
                            ExprKind::Assign { op: Some(_), target, .. } => target == e,
                            ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, .. } => true,
                            _ => false,
                        });
                    if self.is_abstract_property_of_class(file, obj, name, is_written) {
                        out.push(Diagnostic {
                            start: name_pos,
                            code: 2715,
                        });
                        self.explain_abstract_property_access(file, name_pos, obj, name);
                    }
                }
                ExprKind::Assign { target, value, .. } => {
                    let ExprKind::Object(props) = hir[target].kind else {
                        continue;
                    };
                    for p in props.iter() {
                        let prop = &hir[p];
                        if matches!(prop.kind, PropKind::Init | PropKind::Shorthand)
                            && let Some(name) = self.member_name(file, prop.key)
                            && self.is_abstract_property_of_class(file, value, name, true)
                        {
                            out.push(Diagnostic {
                                start: prop.pos,
                                code: 2715,
                            });
                            self.explain_abstract_property_access(file, prop.pos, value, name);
                        }
                    }
                }
                _ => {}
            }
        }
        // `isThisInitializedDeclaration`
        for d in 0..hir.var_decls.len() {
            let decl = &hir.var_decls[d];
            if decl.init.is_none() || !is_this(decl.init) || bound.is_unchecked(decl.init.idx()) {
                continue;
            }
            let PatKind::Object(props) = hir[decl.pat].kind else {
                continue;
            };
            if !self.is_used_during_class_initialization(file, Parent::VarInit(VarDeclId(d as u32)))
            {
                continue;
            }
            for p in props.iter() {
                let prop = &hir[p];
                // `PropertyNameOrName`: of `...rest`, the name that is bound is taken for that of a property.
                let (name, start) = match hir[prop.value].kind {
                    PatKind::Ident(bound_name) if prop.is_rest => {
                        (Some(bound_name), hir[prop.value].pos)
                    }
                    _ => (self.member_name(file, prop.key), prop.pos),
                };
                if let Some(name) = name
                    && self.is_abstract_property_of_class(file, decl.init, name, false)
                {
                    out.push(Diagnostic { start, code: 2715 });
                    self.explain_abstract_property_access(file, start, decl.init, name);
                }
            }
        }
    }

    /// The arguments of 2715, which is reported on the name at `start`: the property `name` of what `this` is, and the class that
    /// declares it.
    fn explain_abstract_property_access(
        &mut self,
        file: FileId,
        start: u32,
        this: ExprId,
        name: Atom,
    ) {
        let end = self.end_of_name_at(file, start);
        self.explain_to(start, end, 2715, |c| {
            let object = c.type_of_expr(file, this);
            let apparent = c.apparent_type(object);
            let Some((prop, _)) = c.prop_of(apparent, name) else {
                return Vec::new();
            };
            let mut class_name = String::new();
            if let PropSource::Members(members) = &prop.source
                && let Some(&(f, m)) = members.first()
                && let MemberOwner::Class(class) = c.bound(f).member_owner[m.idx()]
            {
                let class = c.class_sym(f, class);
                class_name = c.symbol_to_string(class);
            }
            vec![c.prop_to_string(&prop), class_name]
        });
    }

    /// `isNodeUsedDuringClassInitialization`, of what has `parent`: going outwards, a constructor with a body or the declaration
    /// of a property comes before any other function and before any class.
    fn is_used_during_class_initialization(&self, file: FileId, mut parent: Parent) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_constructor =
            |f: FnId| hir[f].kind == FnKind::Constructor && !matches!(hir[f].body, FnBody::None);
        loop {
            match parent {
                Parent::FnBody(f) => return is_constructor(f),
                Parent::ParamDefault(p) | Parent::Decorator(_, DecoratorOwner::Param(p)) => {
                    return is_constructor(bound.param_fn[p.idx()]);
                }
                Parent::MemberInit(m) => {
                    return matches!(bound.member_owner[m.idx()], MemberOwner::Class(_));
                }
                Parent::Decorator(_, DecoratorOwner::Member(m)) => {
                    return hir[m].kind == MemberKind::Property;
                }
                // The name of a property of an object literal is worked out where the literal is.
                Parent::PropKey(literal, _) if literal.is_some() => {
                    parent = bound.expr_parent[literal.idx()]
                }
                Parent::Decorator(_, DecoratorOwner::Class(_))
                | Parent::ClassExtends(_)
                | Parent::PropKey(..)
                | Parent::PatKey(_)
                | Parent::MemberKey(_)
                | Parent::MethodKey(_)
                | Parent::EnumInit(_)
                | Parent::Module(_)
                | Parent::File
                | Parent::None => return false,
                Parent::Stmt(s) if s.is_none() => return false,
                Parent::Expr(x) => parent = bound.expr_parent[x.idx()],
                other => parent = self.outward(file, other),
            }
        }
    }

    /// Whether the property `name` of what `this` is at `this` is declared `abstract` in a class, and is no method.
    fn is_abstract_property_of_class(
        &mut self,
        file: FileId,
        this: ExprId,
        name: Atom,
        is_written: bool,
    ) -> bool {
        let object = self.type_of_expr(file, this);
        if !self.is_known(object) {
            return false;
        }
        let apparent = self.apparent_type(object);
        let Some((prop, _)) = self.prop_ref(apparent, name) else {
            return false;
        };
        let PropSource::Members(members) = &prop.source else {
            return false;
        };
        // `getDeclarationModifierFlagsFromSymbolEx`: of accessors, the one that is used has the say.
        let of_kind = |kind: MemberKind| {
            members
                .iter()
                .copied()
                .find(|&(f, m)| self.hir(f)[m].kind == kind)
        };
        let setter = if is_written {
            of_kind(MemberKind::Setter)
        } else {
            None
        };
        let Some((f, m)) = setter
            .or_else(|| of_kind(MemberKind::Getter))
            .or_else(|| members.first().copied())
        else {
            return false;
        };
        self.hir(f)[m].flags.contains(Flags::ABSTRACT)
            // `symbolHasNonMethodDeclaration`
            && !prop.flags.contains(PropFlags::METHOD)
            && matches!(self.bound(f).member_owner[m.idx()], MemberOwner::Class(_))
    }
}
