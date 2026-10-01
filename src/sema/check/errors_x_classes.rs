//! Classes and interfaces against what they extend, and what only the inside of a class can get wrong:
//! 4112 4113 4114 4115 4116 4117 4127 (`override`), 4121 4122 4123 4128 (`override` in a JavaScript file); 2508 2509 2510 2545 2797
//! 2675 (what a class extends); 2422 (what it implements); 2312 2499 (what an interface extends); 2725 (a class called `Object`);
//! 2376 2401 (where `super()` is called); 2715 (an abstract property read while the instance is set up); 2816 (`this` in a static
//! initializer of a decorated class).
//!
//! Follows `checkClassLikeDeclaration`, `checkBaseTypeAccessibility`, `checkMembersForOverrideModifier`,
//! `checkMemberForOverrideModifier`, `getBaseConstructorTypeOfClass`, `resolveBaseTypesOfClass`, `resolveBaseTypesOfInterface`,
//! `isValidBaseType`, `isMixinConstructorType`, `checkInterfaceDeclaration`, `checkClassNameCollisionWithObject`,
//! `checkConstructorDeclaration`, `checkPropertyAccessibilityAtLocation` and
//! `checkThisInStaticClassFieldInitializerInDecoratedClass` of TypeScript 7.0.2's checker.go.

use super::errors::{Diagnostic, is_close};
use super::*;
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, Parent};
use crate::resolve::ModuleKind;

/// What `getBaseConstructorTypeOfClass` and `getBaseTypes` come to for a class.
#[derive(Copy, Clone)]
enum ClassBase {
    /// It cannot be told.
    Unknown,
    /// It extends nothing, or something that cannot be extended, which is an error of its own.
    Nothing,
    /// `constructor`: the type of what is written after `extends`. `base`: the type of the instances of that.
    Is { constructor: TypeId, base: TypeId },
}

/// What `checkMemberForOverrideModifier` is given: a member of a class, or a parameter that declares a property.
#[derive(Copy, Clone)]
struct Overrider {
    key: PropKey,
    flags: Flags,
    /// Where an error about it goes.
    start: u32,
    is_parameter: bool,
    /// The member, or the constructor that has the parameter.
    member: MemberId,
    /// `NONE` for a member.
    param: ParamId,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Sought {
    /// `findFirstSuperCall`
    SuperCall,
    /// `nodeImmediatelyReferencesSuperOrThis`
    SuperOrThis,
}

/// Whether `e` is written in parentheses of its own.
fn is_parenthesized(hir: &hir::File, e: ExprId) -> bool {
    hir.parens.binary_search_by_key(&e.0, |p| p.0.0).is_ok()
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

/// Where the member whose name is at `pos` starts: at the first of the modifiers before the name.
fn start_with_modifiers(text: &[u8], mut pos: u32) -> u32 {
    while let Some((start, _)) = modifier_before(text, pos) {
        pos = start;
    }
    pos
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
        for c in 0..hir.classes.len() {
            let is_bound = match bound.class_owner[c] {
                ClassOwner::Expr(x) => {
                    x.is_some() && !matches!(bound.expr_parent[x.idx()], Parent::None)
                }
                ClassOwner::Stmt(s) => s.is_some(),
            };
            if is_bound && bound.class_symbol[c].is_some() {
                self.check_class_like_declaration(file, ClassId(c as u32), out);
            }
        }
        for i in 0..hir.interfaces.len() {
            if bound.interface_symbol[i].is_some() {
                self.check_bases_of_interface(file, InterfaceId(i as u32), out);
            }
        }
        self.check_super_call_placement(file, out);
        self.check_abstract_properties_in_constructors(file, out);
        self.check_this_in_static_initializers_of_decorated_classes(file, out);
    }

    // ───────────────────────────── what a class extends and implements ─────────────────────────────

    /// The parts of `checkClassLikeDeclaration` that the codes above come from.
    fn check_class_like_declaration(
        &mut self,
        file: FileId,
        c: ClassId,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let class = &hir[c];
        let sym = self.class_sym(file, c);
        // `checkClassNameCollisionWithObject`
        if class.name == known::Object
            && !class.flags.contains(Flags::AMBIENT)
            && self.emits_module_format_before_es2015(file)
        {
            out.push(Diagnostic {
                start: class.name_pos,
                code: 2725,
            });
            let module = super::errors_x_modules::module_kind_name(self.p.files.options.module);
            self.note(class.name_pos, 0, 2725, vec![module.to_owned()]);
        }
        let base = self.resolve_base_of_class(file, c, sym, out);
        if let ClassBase::Is { constructor, .. } = base {
            self.check_base_type_accessibility(file, c, constructor, out);
            if self.is_type_variable(constructor) {
                self.check_mixin_class(file, c, sym, constructor, out);
            }
        }
        self.check_members_for_override_modifier(file, c, sym, base, out);
        for node in hir.ids(class.implements) {
            // The name of a primitive type is a name that nothing goes by here, which is said elsewhere.
            if !matches!(hir[node].kind, TypeNodeKind::Ref { .. }) {
                continue;
            }
            let implemented = self.type_from_node(file, node);
            let implemented = self.force(implemented);
            let implemented = self.reduced_base_type(implemented);
            if self.is_settled_base(implemented) && !self.is_valid_base_type(implemented) {
                out.push(Diagnostic {
                    start: hir[node].pos,
                    code: 2422,
                });
                let end = self.end_of_type_node(file, node);
                self.note(hir[node].pos, end, 2422, Vec::new());
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

    /// `getBaseConstructorTypeOfClass` and `resolveBaseTypesOfClass`, with 2508 and 2509, and the 2510 of
    /// `checkClassLikeDeclaration`, which goes over the same signatures.
    fn resolve_base_of_class(
        &mut self,
        file: FileId,
        c: ClassId,
        sym: Sym,
        out: &mut Vec<Diagnostic>,
    ) -> ClassBase {
        let hir = self.hir(file);
        let class = &hir[c];
        let extends = class.extends;
        if extends.is_none() {
            return ClassBase::Nothing;
        }
        // `getBaseTypes`: what an interface of the same name extends comes after what the class extends, or in its place.
        let interface_extends = self.files().decls(sym).iter().any(
            |&(f, decl)| matches!(decl, Decl::Interface(i) if !self.hir(f)[i].extends.is_empty()),
        );
        let nothing = if interface_extends {
            ClassBase::Unknown
        } else {
            ClassBase::Nothing
        };
        // What is in error is not extended.
        if self.is_rooted_in_error(file, extends) {
            return nothing;
        }
        let constructor = self.type_of_expr(file, extends);
        if !self.is_known(constructor) || self.is_uncertain(file, extends) {
            return ClassBase::Unknown;
        }
        // A type parameter that is not in scope here is left over from an incomplete resolution.
        let is_generic_here = !class.type_params.is_empty() || self.has_outer_type_parameters(sym);
        if !is_generic_here && self.has_type_variables_except_this(file, c, constructor) {
            return ClassBase::Unknown;
        }
        if constructor == TypeId::NULL {
            return nothing;
        }
        let apparent = self.apparent_type(constructor);
        if !self.is_known(apparent) {
            return ClassBase::Unknown;
        }
        // `isConstructorType`
        if constructor != TypeId::ANY && self.signatures(apparent, true).is_empty() {
            return nothing;
        }
        if !(self.is_object_type(apparent)
            || self.is_intersection(apparent)
            || apparent == TypeId::ANY)
        {
            return nothing;
        }
        let args = self.types_from_nodes(file, class.extends_args);
        if args.iter().any(|&arg| !self.is_known(arg)) {
            return ClassBase::Unknown;
        }
        let start = self.start_of(file, extends);
        let base_class = match *self.data(apparent) {
            TypeData::Anon {
                origin: Origin::ClassStatic(target),
                ..
            } => Some(target),
            _ => None,
        };
        let mut returns = Vec::new();
        let base = match base_class {
            // `areAllOuterTypeParametersApplied`, `getTypeFromClassOrInterfaceReference`
            Some(target) if !self.has_outer_type_parameters(target) => {
                let (least, most) = self.type_argument_arity(target);
                if hir.is_js && most > 0 {
                    // In a JavaScript file a wrong type argument count does not give the error type, and
                    // `fillMissingTypeArguments` supplies `any` for the missing arguments.
                    let params = self.type_params_of_symbol(target);
                    let filled = self.fill_type_args_as(&params, &args, true);
                    self.type_reference(target, &filled)
                } else if args.len() < least || args.len() > most {
                    return nothing;
                } else {
                    self.type_reference(target, &args)
                }
            }
            _ if apparent == TypeId::ANY => TypeId::ANY,
            _ => {
                let Some(list) = self.base_constructor_returns(apparent, &args) else {
                    return ClassBase::Unknown;
                };
                returns = list;
                let Some(&first) = returns.first() else {
                    out.push(Diagnostic { start, code: 2508 });
                    self.note(start, self.end_of_expr(file, extends), 2508, Vec::new());
                    return nothing;
                };
                first
            }
        };
        let mapper = self.decl_params_mapper(sym, file, class.type_params);
        let base = self.instantiate(base, mapper);
        let base = self.force(base);
        if !self.is_settled_base(base)
            || !is_generic_here && self.has_type_variables_except_this(file, c, base)
        {
            return ClassBase::Unknown;
        }
        let unreduced = base;
        let base = self.reduced_base_type(base);
        if !self.is_valid_base_type(base) {
            out.push(Diagnostic { start, code: 2509 });
            let end = self.end_of_expr(file, extends);
            self.explain_to(start, end, 2509, |c| vec![c.type_to_string(base)]);
            self.explain_chain(start, 2509, |c| {
                c.never_intersection_line(unreduced).into_iter().collect()
            });
            return nothing;
        }
        if self.has_base(base, sym, 0) {
            return nothing;
        }
        // What is like a class without being one has to make the same thing whichever way it is called. An `any` that comes first
        // may stand for what is in error, and then nothing is extended.
        if base_class.is_none() && !self.is_type_variable(constructor) && base != TypeId::ANY {
            let gave_up_before = std::mem::replace(&mut self.relation_gave_up, false);
            let mut all_the_same = true;
            for &returned in &returns {
                let returned = self.instantiate(returned, mapper);
                if !self.is_known(returned) {
                    all_the_same = true;
                    break;
                }
                all_the_same &= self.is_identical(returned, base);
            }
            // What a comparison that was cut short came to is told nobody.
            let is_sure = !self.relation_gave_up && !self.timed_out();
            self.relation_gave_up |= gave_up_before;
            if !all_the_same && is_sure {
                out.push(Diagnostic { start, code: 2510 });
                self.note(start, self.end_of_expr(file, extends), 2510, Vec::new());
            }
        }
        ClassBase::Is { constructor, base }
    }

    /// Whether `e` starts with a name that stands for nothing, no value going by it or the module it is imported from not being
    /// there. What is in error stays so through `.`, `[]` and calls.
    fn is_rooted_in_error(&self, file: FileId, mut e: ExprId) -> bool {
        let hir = self.hir(file);
        loop {
            e = match hir[e].kind {
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
                ExprKind::Call(call) => hir[call].callee,
                ExprKind::NonNull(inner) => inner,
                ExprKind::Ident(name) => {
                    return !matches!(
                        name,
                        known::undefined | known::arguments | known::globalThis
                    ) && self
                        .symbol_of_identifier(file, e, name)
                        .is_none_or(|named| self.is_alias_in_error(named));
                }
                _ => return false,
            };
        }
    }

    /// Whether `class` is declared inside something that has type parameters: `getOuterTypeParametersOfClassOrInterface`.
    fn has_outer_type_parameters(&mut self, class: Sym) -> bool {
        for (f, decl) in self.files().decls(class) {
            let Decl::Class(c) = decl else { continue };
            let scope = self.bound(f).class_scope[c.idx()];
            if scope.is_none() {
                return false;
            }
            let around = self.bound(f).scopes[scope.idx()].parent;
            let params = self.outer_type_params(f, around);
            return params
                .iter()
                .any(|&param| matches!(self.data(param), TypeData::TypeParam(..)));
        }
        false
    }

    /// Whether `ty` still has type variables once the `this` types in scope in the heritage clause of class `c` are erased.
    /// A class, function or object literal written inside a class captures the `this` type of that class, heritage clause
    /// included (`getOuterTypeParameters` with `includeThisTypes`). That does not make the class generic.
    fn has_type_variables_except_this(&mut self, file: FileId, c: ClassId, ty: TypeId) -> bool {
        if !self.has_type_variables(ty) {
            return false;
        }
        let scope = self.bound(file).class_scope[c.idx()];
        let in_scope = self.outer_type_params(file, scope);
        let this_to_any: Vec<(TypeId, TypeId)> = in_scope
            .iter()
            .filter(|&&param| matches!(self.data(param), TypeData::ThisParam(_)))
            .map(|&param| (param, TypeId::ANY))
            .collect();
        let erase_this = self.p.types.mapper(this_to_any);
        let erased = self.instantiate(ty, erase_this);
        // `instantiate` returns an unknown type at its depth limit, which tells nothing about `ty`.
        !self.is_known(erased) || self.has_type_variables(erased)
    }

    /// `getInstantiatedConstructorsForTypeArguments`, of the construct signatures `sigs`.
    fn constructors_for_type_arguments(&mut self, sigs: &[SigId], args: &[TypeId]) -> Vec<SigId> {
        let mut out = Vec::with_capacity(sigs.len());
        for &sig in sigs {
            let params = self.sig_type_params(sig);
            // `getMinTypeArgumentCount`
            let least = (0..params.len())
                .rev()
                .find(|&i| self.default_of_type_param(params[i]).is_none())
                .map_or(0, |i| i + 1);
            if args.len() < least || args.len() > params.len() {
                continue;
            }
            if params.is_empty() {
                out.push(sig);
                continue;
            }
            let filled = self.fill_sig_type_args(sig, &params, args);
            let mapper = self.mapper_from(&params, &filled);
            out.push(self.instantiate_sig(sig, mapper));
        }
        out
    }

    /// The construct signatures of `constructor`, member by member if it is an intersection, and which of the members lose theirs
    /// in `resolveIntersectionTypeMembers`, being mixin constructors next to a constructor that is not: `findMixins`.
    /// `None`: it cannot be told which are.
    fn construct_signatures_by_member(
        &mut self,
        constructor: TypeId,
    ) -> Option<(Vec<Vec<SigId>>, Vec<bool>)> {
        let parts: &[TypeId] = match self.data(constructor) {
            TypeData::Intersection(parts) => &parts[..],
            _ => std::slice::from_ref(&constructor),
        };
        let mut lists: Vec<Vec<SigId>> = Vec::with_capacity(parts.len());
        let mut is_mixin: Vec<bool> = Vec::with_capacity(parts.len());
        for &part in parts {
            let sigs = self.signatures(part, true);
            is_mixin.push(parts.len() > 1 && self.is_mixin_constructor(&sigs)?);
            lists.push(sigs);
        }
        let constructor_types = lists.iter().filter(|sigs| !sigs.is_empty()).count();
        let mixins = is_mixin.iter().filter(|&&mixin| mixin).count();
        if constructor_types > 0
            && constructor_types == mixins
            && let Some(first) = is_mixin.iter().position(|&mixin| mixin)
        {
            is_mixin[first] = false;
        }
        Some((lists, is_mixin))
    }

    /// What the signatures `getInstantiatedConstructorsForTypeArguments` gives for `constructor` return. What a mixin constructor
    /// in an intersection makes is part of what the other members make: `includeMixinType`. `None`: it cannot be told.
    fn base_constructor_returns(
        &mut self,
        constructor: TypeId,
        args: &[TypeId],
    ) -> Option<Vec<TypeId>> {
        let (lists, is_mixin) = self.construct_signatures_by_member(constructor)?;
        let has_mixins = is_mixin.contains(&true);
        let mut returns = Vec::new();
        for i in 0..lists.len() {
            if is_mixin[i] {
                continue;
            }
            for sig in self.constructors_for_type_arguments(&lists[i], args) {
                let returned = self.sig_return(sig);
                if !has_mixins {
                    returns.push(returned);
                    continue;
                }
                let mut mixed = Vec::with_capacity(lists.len());
                for j in 0..lists.len() {
                    if j == i {
                        mixed.push(returned);
                    } else if is_mixin[j] {
                        mixed.push(self.sig_return(lists[j][0]));
                    }
                }
                returns.push(self.intersection(&mixed));
            }
        }
        Some(returns)
    }

    /// `isMixinConstructorType`, of a type whose construct signatures are `sigs`: one signature, without type parameters, that
    /// takes `...args: any[]` and nothing else. `None`: it cannot be told.
    fn is_mixin_constructor(&mut self, sigs: &[SigId]) -> Option<bool> {
        let [sig] = sigs[..] else { return Some(false) };
        if !self.sig_type_params(sig).is_empty() {
            return Some(false);
        }
        let params = self.sig_params(sig);
        let [param] = &params[..] else {
            return Some(false);
        };
        if !param.rest {
            return Some(false);
        }
        if !self.is_known(param.ty) {
            return None;
        }
        Some(param.ty == TypeId::ANY || self.array_element(param.ty) == Some(TypeId::ANY))
    }

    /// 2545 2797: a class that extends a value whose type is a type variable. Its static side is `typeof C & T`, whose construct
    /// signatures are those of `resolveIntersectionTypeMembers`: they come to a mixin constructor if both members are one.
    fn check_mixin_class(
        &mut self,
        file: FileId,
        c: ClassId,
        sym: Sym,
        constructor: TypeId,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let class = &hir[c];
        let apparent = self.apparent_type(constructor);
        let Some((lists, is_dropped)) = self.construct_signatures_by_member(apparent) else {
            return;
        };
        let base_sigs: Vec<SigId> = lists
            .iter()
            .zip(&is_dropped)
            .filter(|x| !*x.1)
            .flat_map(|x| x.0.iter().copied())
            .collect();
        let own_is_mixin = if class
            .members
            .iter()
            .any(|m| hir[m].kind == MemberKind::Constructor)
        {
            let statics = self.type_of_symbol(sym);
            let is_own = |c: &Self, t: TypeId| matches!(*c.data(t), TypeData::Anon { origin: Origin::ClassStatic(s), .. } if s == sym);
            let statics = match self.data(statics) {
                TypeData::Intersection(parts) => parts
                    .iter()
                    .copied()
                    .find(|&part| is_own(self, part))
                    .unwrap_or(statics),
                _ => statics,
            };
            let own = self.signatures(statics, true);
            self.is_mixin_constructor(&own)
        } else if self.type_params_of_symbol(sym).is_empty() {
            // `getDefaultConstructSignatures`: it is made the ways what it extends is.
            let args = self.types_from_nodes(file, class.extends_args);
            let own = self.constructors_for_type_arguments(&base_sigs, &args);
            self.is_mixin_constructor(&own)
        } else {
            Some(false)
        };
        let (Some(own_is_mixin), Some(base_is_mixin)) =
            (own_is_mixin, self.is_mixin_constructor(&base_sigs))
        else {
            return;
        };
        let start = if class.name.is_some() {
            class.name_pos
        } else {
            class.pos
        };
        if !(own_is_mixin && (base_is_mixin || base_sigs.is_empty())) {
            out.push(Diagnostic { start, code: 2545 });
        } else if !class.flags.contains(Flags::ABSTRACT)
            && base_sigs.iter().any(|&sig| self.is_abstract_signature(sig))
        {
            out.push(Diagnostic { start, code: 2797 });
        }
    }

    /// `checkBaseTypeAccessibility`: 2675, only from within a class can what it makes privately be extended.
    fn check_base_type_accessibility(
        &mut self,
        file: FileId,
        c: ClassId,
        constructor: TypeId,
        out: &mut Vec<Diagnostic>,
    ) {
        let apparent = self.apparent_type(constructor);
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
                    let Some(&inherited) = self.base_constructor_sigs(of).get(base as usize) else {
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
            out.push(Diagnostic { start, code: 2675 });
            // The type arguments are part of what is extended.
            let last_argument = self.end_of_type_args(file, self.hir(file)[c].extends_args);
            let end = if last_argument == 0 {
                self.end_of_expr(file, extends)
            } else {
                let rest = self.hir(file).text.get(last_argument as usize..);
                let close = rest.and_then(|rest| rest.iter().position(|&b| b == b'>'));
                last_argument + close.map_or(0, |at| at as u32 + 1)
            };
            self.explain_to(start, end, 2675, |c| {
                vec![super::errors_modules::fully_qualified_name(c, class)]
            });
        }
    }

    /// Whether `ty` was worked out for good: all of it is known, and it does not wait for type parameters that are not there.
    fn is_settled_base(&self, ty: TypeId) -> bool {
        self.is_known(ty) && (self.has_type_variables(ty) || !self.is_deferred(ty))
    }

    /// `isValidBaseType`: `any`, an object type whose members can be told, or an intersection of such. What is not known passes.
    pub(super) fn is_valid_base_type(&mut self, ty: TypeId) -> bool {
        let ty = self.force(ty);
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
                (self.is_object_type(ty) || ty == TypeId::OBJECT || ty == TypeId::ANY)
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
                    && parts.iter().any(|part| part.source != parts[0].source)
                {
                    return TypeId::NEVER;
                }
            }
        }
        ty
    }

    // ───────────────────────────── what an interface extends ─────────────────────────────

    /// `resolveBaseTypesOfInterface`: 2312. The end of `checkInterfaceDeclaration`: 2499.
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
            if matches!(hir[node].kind, TypeNodeKind::Error) {
                out.push(Diagnostic {
                    start: hir[node].pos,
                    code: 2499,
                });
                continue;
            }
            let base = self.type_from_node(file, node);
            let base = self.force(base);
            let base = self.reduced_base_type(base);
            if self.is_settled_base(base) && !self.is_valid_base_type(base) {
                out.push(Diagnostic {
                    start: hir[node].pos,
                    code: 2312,
                });
                let end = self.end_of_type_node(file, node);
                self.note(hir[node].pos, end, 2312, Vec::new());
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
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let class = &hir[c];
        for m in class.members.iter() {
            let member = &hir[m];
            // `HasAmbientModifier`: `declare` is written on the member itself. Every member of an ambient class has
            // `Flags::AMBIENT`, so there the source text decides.
            if member.flags.contains(Flags::AMBIENT)
                && (!class.flags.contains(Flags::AMBIENT)
                    || has_declare_modifier(&hir.text, member.pos))
            {
                continue;
            }
            if member.kind != MemberKind::Constructor {
                let overrider = Overrider {
                    key: member.key,
                    flags: member.flags,
                    start: member.pos,
                    is_parameter: false,
                    member: m,
                    param: ParamId::NONE,
                };
                self.check_member_for_override_modifier(file, c, sym, base, overrider, out);
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
                    start: param.pos,
                    is_parameter: true,
                    member: m,
                    param: p,
                };
                self.check_member_for_override_modifier(file, c, sym, base, overrider, out);
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
        out: &mut Vec<Diagnostic>,
    ) {
        let start = member.start;
        let has_override = member.flags.contains(Flags::OVERRIDE);
        let no_implicit_override = self.p.files.options.no_implicit_override;
        let is_js = self.hir(file).is_js;
        // A member without `override` is only checked under `noImplicitOverride`. JSDoc is not parsed, so a JavaScript member
        // without the keyword may still have an `@override` tag: whether it has the modifier is unknown.
        if !has_override && (!no_implicit_override || is_js) {
            return;
        }
        let mut report = |code: u32| {
            out.push(Diagnostic {
                start,
                code: if is_js { js_override_code(code) } else { code },
            })
        };
        let (constructor, base) = match base {
            ClassBase::Unknown => return,
            ClassBase::Nothing => {
                if has_override {
                    report(4112);
                    let class_type = self.declared_type(sym);
                    self.explain_override_modifier(file, member, 4112, Some(class_type), None);
                }
                return;
            }
            ClassBase::Is { constructor, base } => (constructor, base),
        };
        // `any` may stand for what is in error, a type that no name goes by, and then nothing is extended: 4112, not 4113.
        if base == TypeId::ANY {
            return;
        }
        // A name that is only known when the program runs is the name of no property that could be looked up.
        if let PropKey::Computed(name) = member.key {
            match self.is_bindable_computed_name(file, name) {
                None => return,
                Some(false) => {
                    if has_override {
                        report(4127);
                        self.explain_override_modifier(file, member, 4127, None, None);
                    }
                    return;
                }
                Some(true) => {}
            }
        }
        let Some(name) = self.member_name(file, member.key) else {
            return;
        };
        let is_static = !member.is_parameter && member.flags.contains(Flags::STATIC);
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
            if has_override && self.is_heritage_known(base_type, 0) {
                let code = if self.has_similar_member(base_type, name) {
                    4117
                } else {
                    4113
                };
                report(code);
                let misspelt = (code == 4117).then_some((base_type, name));
                self.explain_override_modifier(file, member, code, Some(base), misspelt);
            }
            return;
        };
        if has_override || !no_implicit_override || self.hir(file)[c].flags.contains(Flags::AMBIENT)
        {
            return;
        }
        let Some((is_declared, is_abstract)) = self.declarations_of_base_property(&base_prop)
        else {
            return;
        };
        if !is_declared {
            return;
        }
        if !is_abstract {
            let code = if member.is_parameter { 4115 } else { 4114 };
            report(code);
            self.explain_override_modifier(file, member, code, Some(base), None);
        } else if member.flags.contains(Flags::ABSTRACT) {
            report(4116);
            self.explain_override_modifier(file, member, 4116, Some(base), None);
        }
    }

    /// The end and the arguments of what `checkMemberForOverrideModifier` says of `member`. `named`: the class itself or what it
    /// extends. `misspelt`: where to look for what the name may have been meant to be.
    fn explain_override_modifier(
        &mut self,
        file: FileId,
        member: Overrider,
        code: u32,
        named: Option<TypeId>,
        misspelt: Option<(TypeId, Atom)>,
    ) {
        let code = if self.hir(file).is_js {
            js_override_code(code)
        } else {
            code
        };
        let end = if member.is_parameter {
            self.end_of_param(file, member.param)
        } else {
            self.error_end_of_member(file, member.member)
        };
        self.explain_to(member.start, end, code, |c| {
            let mut args = Vec::new();
            if let Some(named) = named {
                args.push(c.type_to_string(named));
            }
            if let Some((in_type, name)) = misspelt
                && let Some(prop) = c.suggested_member(in_type, name)
            {
                args.push(c.prop_to_string(&prop));
            }
            args
        });
    }

    /// Whether the computed name `e` comes to a name that is known beforehand: not `isNonBindableDynamicName`.
    /// `None`: it cannot be told.
    fn is_bindable_computed_name(&mut self, file: FileId, e: ExprId) -> Option<bool> {
        let hir = self.hir(file);
        if is_parenthesized(hir, e) {
            return Some(false);
        }
        // `IsDynamicName`: a template without substitutions is as good as a string, `IsSignedNumericLiteral` as the number.
        match hir[e].kind {
            ExprKind::Template { exprs, .. } if exprs.is_empty() => return Some(true),
            ExprKind::Unary {
                op: UnOp::Plus | UnOp::Minus,
                operand,
            } if matches!(hir[operand].kind, ExprKind::Number(_))
                && !is_parenthesized(hir, operand) =>
            {
                return Some(true);
            }
            _ => {}
        }
        // `isLateBindableAST`
        let mut at = e;
        while let ExprKind::Dot { obj, name, .. } = hir[at].kind {
            if self.files().atoms.bytes(name).first() == Some(&b'#') || is_parenthesized(hir, obj) {
                return Some(false);
            }
            at = obj;
        }
        if !matches!(hir[at].kind, ExprKind::Ident(_)) {
            return Some(false);
        }
        let ty = self.type_of_expr(file, e);
        if !self.is_known(ty) || self.is_uncertain(file, e) {
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

    /// `getSuggestedSymbolForNonexistentClassMember`: whether `ty` has a property that `name` may be a misspelling of.
    fn has_similar_member(&mut self, ty: TypeId, name: Atom) -> bool {
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
        self.members(apparent).is_some_and(|members| {
            members.shape().props.iter().any(|prop| {
                let candidate = self.written_name(prop.name);
                // `getCandidateName`: an internal name is never suggested, and only `SymbolFlagsClassMember` counts, which the
                // exports of a namespace merged with the class are not.
                !matches!(prop.source, PropSource::Symbol(_))
                    && !candidate.starts_with(crate::atom::SYMBOL_NAME_PREFIX)
                    && is_close(text, candidate)
            })
        })
    }

    /// `getSuggestedSymbolForNonexistentClassMember`: the property `has_similar_member` says there is. `GetSpellingSuggestion` takes
    /// the closest, and of two that are as close the first.
    fn suggested_member(&mut self, ty: TypeId, name: Atom) -> Option<Prop> {
        let written = self.written_name(name);
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
        let mut best: Option<(f64, &Prop)> = None;
        for prop in &members.shape().props {
            let candidate = self.written_name(prop.name);
            if matches!(prop.source, PropSource::Symbol(_))
                || candidate.starts_with(crate::atom::SYMBOL_NAME_PREFIX)
                || !is_close(text, candidate)
            {
                continue;
            }
            let distance = super::errors_access::edit_distance(text, candidate);
            if best.is_none_or(|(least, _)| distance + 0.05 < least) {
                best = Some((distance, prop));
            }
        }
        best.map(|(_, prop)| prop.clone())
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
            PropSource::Intersected(_, parts) => {
                let (mut is_declared, mut is_abstract) = (false, false);
                for part in parts.iter() {
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

    /// Whether all that `ty` inherits from could be worked out, and is what its members were put together from, so that what is
    /// not found in it is not there.
    fn is_heritage_known(&mut self, ty: TypeId, depth: u32) -> bool {
        if !self.is_known(ty) || depth > 32 {
            return false;
        }
        match self.data(ty) {
            TypeData::Ref { target, .. } => {
                let target = *target;
                let bases = self.base_types(target);
                for (f, decl) in self.files().decls(target) {
                    let hir = self.hir(f);
                    // A member that could not be made sense of is left out.
                    if hir.has_errors || hir.syntax_errors > 0 {
                        return false;
                    }
                    match decl {
                        Decl::Class(c) if hir[c].extends.is_some() => {
                            match self.resolve_base_of_class(f, c, target, &mut Vec::new()) {
                                ClassBase::Unknown => return false,
                                ClassBase::Nothing => {}
                                // What a class gets from a type variable is whatever that stands for where the class is made, which
                                // a reference to the class does not keep. `base_types` knows nothing of mixin constructors.
                                ClassBase::Is { constructor, base } => {
                                    if self.has_type_variables_except_this(f, c, constructor)
                                        || base != TypeId::ANY && !bases.contains(&base)
                                    {
                                        return false;
                                    }
                                }
                            }
                        }
                        Decl::Interface(i) => {
                            for node in hir.ids(hir[i].extends) {
                                let base = self.type_from_node(f, node);
                                if !self.is_known(base) {
                                    return false;
                                }
                            }
                        }
                        _ => {}
                    }
                }
                bases
                    .iter()
                    .all(|&base| self.is_heritage_known(base, depth + 1))
            }
            TypeData::Anon {
                origin: Origin::ClassStatic(target),
                ..
            } => {
                let instance = self.declared_type(*target);
                self.is_heritage_known(instance, depth + 1)
            }
            TypeData::Intersection(parts) => parts
                .iter()
                .all(|&part| self.is_heritage_known(part, depth + 1)),
            // It is looked up in what it is known to be at least.
            _ if self.is_deferred(ty) => {
                let apparent = self.apparent_type(ty);
                apparent != ty && self.is_heritage_known(apparent, depth + 1)
            }
            _ => true,
        }
    }

    // ───────────────────────────── where `super()` is called ─────────────────────────────

    /// The end of `checkConstructorDeclaration`: 2401 2376. Where fields are set up by assignments put in the constructor, they
    /// go right after the call of `super`, which therefore has to be a statement of the constructor itself, and the first
    /// that has to do with `this`.
    fn check_super_call_placement(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        if self.p.files.options.emit_standard_class_fields {
            return;
        }
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
            let Some(first) = self.sought_in_stmts(file, body, Sought::SuperCall) else {
                continue;
            };
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
                if self.sought_in_stmt(file, s, Sought::SuperOrThis).is_some() {
                    break;
                }
            }
            if !is_first {
                let start = start_with_modifiers(&hir.text, hir[m].pos);
                out.push(Diagnostic { start, code: 2376 });
                // `GetErrorRangeForNode`: up to the keyword.
                self.note(
                    start,
                    self.end_of_name_at(file, hir[m].pos),
                    2376,
                    Vec::new(),
                );
            }
        }
    }

    fn sought_in_stmts(&self, file: FileId, list: IdList<StmtId>, what: Sought) -> Option<ExprId> {
        self.hir(file)
            .ids(list)
            .find_map(|s| self.sought_in_stmt(file, s, what))
    }

    fn sought_in_exprs(&self, file: FileId, list: IdList<ExprId>, what: Sought) -> Option<ExprId> {
        self.hir(file)
            .ids(list)
            .find_map(|e| self.sought_in_expr(file, e, what))
    }

    /// The first `what` in the statement `s`, in the order things are written, leaving out what `what` does not look into.
    fn sought_in_stmt(&self, file: FileId, s: StmtId, what: Sought) -> Option<ExprId> {
        if s.is_none() || self.is_stack_low() {
            return None;
        }
        let hir = self.hir(file);
        let expr = |e: ExprId| self.sought_in_expr(file, e, what);
        let stmt = |inner: StmtId| self.sought_in_stmt(file, inner, what);
        let var = |d: VarDeclId| {
            self.sought_in_pat(file, hir[d].pat, what)
                .or_else(|| expr(hir[d].init))
        };
        match hir[s].kind {
            StmtKind::Expr(e)
            | StmtKind::Return(e)
            | StmtKind::Throw(e)
            | StmtKind::ExportDefault(e)
            | StmtKind::ExportAssign(e) => expr(e),
            StmtKind::Var(decls) => decls.iter().find_map(var),
            StmtKind::Class(c) => self.sought_in_class(file, c, what),
            StmtKind::Enum(e) => hir[e].members.iter().find_map(|m| expr(hir[m].init)),
            StmtKind::Module(m) => self.sought_in_stmts(file, hir[m].body, what),
            StmtKind::If { test, yes, no } => expr(test).or_else(|| stmt(yes)).or_else(|| stmt(no)),
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => stmt(init)
                .or_else(|| expr(test))
                .or_else(|| expr(update))
                .or_else(|| stmt(body)),
            StmtKind::ForIn {
                left,
                expr: of,
                body,
            }
            | StmtKind::ForOf {
                left,
                expr: of,
                body,
                ..
            } => stmt(left).or_else(|| expr(of)).or_else(|| stmt(body)),
            StmtKind::While { test, body } => expr(test).or_else(|| stmt(body)),
            StmtKind::DoWhile { body, test } => stmt(body).or_else(|| expr(test)),
            StmtKind::Block(list) => self.sought_in_stmts(file, list, what),
            StmtKind::Switch { expr: on, cases } => expr(on).or_else(|| {
                cases.iter().find_map(|case| {
                    expr(hir[case].test)
                        .or_else(|| self.sought_in_stmts(file, hir[case].body, what))
                })
            }),
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => stmt(block)
                .or_else(|| if param.is_some() { var(param) } else { None })
                .or_else(|| stmt(handler))
                .or_else(|| stmt(finalizer)),
            StmtKind::Labeled { body, .. } => stmt(body),
            // A function declaration is looked into by neither, and the rest has nothing that runs.
            _ => None,
        }
    }

    fn sought_in_expr(&self, file: FileId, e: ExprId, what: Sought) -> Option<ExprId> {
        if e.is_none() || self.is_stack_low() {
            return None;
        }
        let hir = self.hir(file);
        let expr = |inner: ExprId| self.sought_in_expr(file, inner, what);
        match hir[e].kind {
            ExprKind::This | ExprKind::Super => (what == Sought::SuperOrThis).then_some(e),
            ExprKind::Template { exprs, .. } | ExprKind::Array(exprs) => {
                self.sought_in_exprs(file, exprs, what)
            }
            ExprKind::Call(c)
                if what == Sought::SuperCall
                    && matches!(hir[hir[c].callee].kind, ExprKind::Super) =>
            {
                Some(e)
            }
            ExprKind::TaggedTemplate(c) | ExprKind::Call(c) | ExprKind::New(c) => {
                expr(hir[c].callee).or_else(|| self.sought_in_exprs(file, hir[c].args, what))
            }
            ExprKind::Object(props) => self.sought_in_props(file, props, what),
            ExprKind::Fn(f) => self.sought_in_fn(file, f, what),
            ExprKind::Class(c) => self.sought_in_class(file, c, what),
            ExprKind::Dot { obj, .. } => expr(obj),
            ExprKind::Index { obj, index, .. } => expr(obj).or_else(|| expr(index)),
            ExprKind::Binary { left, right, .. }
            | ExprKind::Assign {
                target: left,
                value: right,
                ..
            } => expr(left).or_else(|| expr(right)),
            ExprKind::Cond { test, yes, no } => {
                expr(test).or_else(|| expr(yes)).or_else(|| expr(no))
            }
            ExprKind::Unary { operand: inner, .. }
            | ExprKind::Spread(inner)
            | ExprKind::Await(inner)
            | ExprKind::Yield { value: inner, .. }
            | ExprKind::As { expr: inner, .. }
            | ExprKind::Satisfies { expr: inner, .. }
            | ExprKind::AsConst(inner)
            | ExprKind::NonNull(inner)
            | ExprKind::ImportCall(inner) => expr(inner),
            ExprKind::Jsx(j) => {
                let jsx = &hir[j];
                expr(jsx.tag)
                    .or_else(|| self.sought_in_props(file, jsx.attrs, what))
                    .or_else(|| self.sought_in_exprs(file, jsx.children, what))
            }
            _ => None,
        }
    }

    /// In the properties of an object literal, or the attributes of a JSX element.
    fn sought_in_props(&self, file: FileId, props: Span<PropId>, what: Sought) -> Option<ExprId> {
        let hir = self.hir(file);
        props.iter().find_map(|p| {
            let prop = &hir[p];
            // The name of a method is part of the method.
            if what == Sought::SuperCall
                && matches!(
                    prop.kind,
                    PropKind::Method | PropKind::Getter | PropKind::Setter
                )
            {
                return None;
            }
            let in_name = match prop.key {
                PropKey::Computed(name) => self.sought_in_expr(file, name, what),
                _ => None,
            };
            in_name.or_else(|| self.sought_in_expr(file, prop.value, what))
        })
    }

    fn sought_in_pat(&self, file: FileId, pat: PatId, what: Sought) -> Option<ExprId> {
        if pat.is_none() || self.is_stack_low() {
            return None;
        }
        let hir = self.hir(file);
        match hir[pat].kind {
            PatKind::Missing | PatKind::Ident(_) => None,
            PatKind::Object(props) => props.iter().find_map(|p| {
                let prop = &hir[p];
                let in_name = match prop.key {
                    PropKey::Computed(name) => self.sought_in_expr(file, name, what),
                    _ => None,
                };
                in_name
                    .or_else(|| self.sought_in_pat(file, prop.value, what))
                    .or_else(|| self.sought_in_expr(file, prop.default, what))
            }),
            PatKind::Array(elems) => elems.iter().find_map(|x| {
                self.sought_in_pat(file, hir[x].pat, what)
                    .or_else(|| self.sought_in_expr(file, hir[x].default, what))
            }),
        }
    }

    fn sought_in_decorators(
        &self,
        file: FileId,
        of: DecoratorOwner,
        what: Sought,
    ) -> Option<ExprId> {
        self.hir(file)
            .decorators
            .iter()
            .filter(|d| d.0 == of)
            .find_map(|d| self.sought_in_expr(file, d.1, what))
    }

    /// A call of `super` is not looked for in a function of any kind. `this` and `super` are not looked for in a function that is
    /// no member, nor in the body of one that is; a static block is no function.
    fn sought_in_fn(&self, file: FileId, f: FnId, what: Sought) -> Option<ExprId> {
        let hir = self.hir(file);
        let func = &hir[f];
        match (what, func.kind) {
            (
                Sought::SuperOrThis,
                FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor,
            ) => func.params.iter().find_map(|p| {
                self.sought_in_decorators(file, DecoratorOwner::Param(p), what)
                    .or_else(|| self.sought_in_pat(file, hir[p].pat, what))
                    .or_else(|| self.sought_in_expr(file, hir[p].default, what))
            }),
            (_, FnKind::StaticBlock) => match func.body {
                FnBody::Block(list) => self.sought_in_stmts(file, list, what),
                _ => None,
            },
            _ => None,
        }
    }

    fn sought_in_class(&self, file: FileId, c: ClassId, what: Sought) -> Option<ExprId> {
        let hir = self.hir(file);
        let class = &hir[c];
        self.sought_in_decorators(file, DecoratorOwner::Class(c), what)
            .or_else(|| self.sought_in_expr(file, class.extends, what))
            .or_else(|| {
                class.members.iter().find_map(|m| {
                    let member = &hir[m];
                    // The whole of the declaration, with its name and what decorates it.
                    let is_left_out = match what {
                        Sought::SuperOrThis => member.kind == MemberKind::Property,
                        Sought::SuperCall => {
                            matches!(
                                member.kind,
                                MemberKind::Method
                                    | MemberKind::Getter
                                    | MemberKind::Setter
                                    | MemberKind::Constructor
                            )
                        }
                    };
                    if is_left_out {
                        return None;
                    }
                    let in_name = |c: &Self| match member.key {
                        PropKey::Computed(name) => c.sought_in_expr(file, name, what),
                        _ => None,
                    };
                    self.sought_in_decorators(file, DecoratorOwner::Member(m), what)
                        .or_else(|| in_name(self))
                        .or_else(|| {
                            if member.func.is_some() {
                                self.sought_in_fn(file, member.func, what)
                            } else {
                                None
                            }
                        })
                        .or_else(|| self.sought_in_expr(file, member.init, what))
                })
            })
    }

    // ───────────────────────────── abstract properties while the instance is set up ─────────────────────────────

    /// 2715, of `checkPropertyAccessibilityAtLocation`: `this.p`, `const { p } = this` and `({ p } = this)` in a constructor or
    /// in the initializer of a property, where `p` is declared `abstract`: nothing has given it a value by then.
    fn check_abstract_properties_in_constructors(
        &mut self,
        file: FileId,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_this =
            |e: ExprId| matches!(hir[e].kind, ExprKind::This) && !is_parenthesized(hir, e);
        for i in 0..hir.exprs.len() {
            let e = ExprId(i as u32);
            let parent = bound.expr_parent[i];
            if matches!(parent, Parent::None) {
                continue;
            }
            match hir.exprs[i].kind {
                // `isThisProperty`
                ExprKind::Dot {
                    obj,
                    name,
                    name_pos,
                    ..
                } if is_this(obj) => {
                    if bound.is_in_type_query(e)
                        || !self.is_used_during_class_initialization(file, parent)
                    {
                        continue;
                    }
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
                // `isThisInitializedObjectBindingExpression`
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } if is_this(value) => {
                    let ExprKind::Object(props) = hir[target].kind else {
                        continue;
                    };
                    if is_parenthesized(hir, target)
                        || !self.is_used_during_class_initialization(file, parent)
                    {
                        continue;
                    }
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
            if decl.init.is_none()
                || !is_this(decl.init)
                || matches!(bound.expr_parent[decl.init.idx()], Parent::None)
            {
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
                Parent::Key(literal) if literal.is_some() => {
                    parent = bound.expr_parent[literal.idx()]
                }
                Parent::Decorator(_, DecoratorOwner::Class(_))
                | Parent::ClassExtends(_)
                | Parent::Key(_)
                | Parent::MemberKey
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
        let Some((prop, _)) = self.prop_of(apparent, name) else {
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

    // ───────────────────────────── `this` in a decorated class ─────────────────────────────

    /// `checkThisInStaticClassFieldInitializerInDecoratedClass`: 2816. With the decorators of old the class may be replaced by what
    /// decorates it, and `this` in the initializer of a static property would still be the one that was replaced.
    fn check_this_in_static_initializers_of_decorated_classes(
        &self,
        file: FileId,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !self.p.files.options.experimental_decorators
            || !hir
                .decorators
                .iter()
                .any(|d| matches!(d.0, DecoratorOwner::Class(_)))
        {
            return;
        }
        for i in 0..hir.exprs.len() {
            if !matches!(hir.exprs[i].kind, ExprKind::This)
                || bound.is_in_type_query(ExprId(i as u32))
            {
                continue;
            }
            // `GetThisContainer`, through arrow functions.
            let mut parent = bound.expr_parent[i];
            // The outermost expression so far: a computed name is told by it.
            let mut top = ExprId(i as u32);
            let container = loop {
                match parent {
                    Parent::MemberInit(m) => break Some(m),
                    Parent::FnBody(f) if hir[f].kind == FnKind::Arrow => {
                        parent = self.outward(file, parent)
                    }
                    Parent::ParamDefault(p)
                        if hir[bound.param_fn[p.idx()]].kind == FnKind::Arrow =>
                    {
                        parent = self.outward(file, Parent::FnBody(bound.param_fn[p.idx()]));
                    }
                    Parent::FnBody(_)
                    | Parent::ParamDefault(_)
                    | Parent::EnumInit(_)
                    | Parent::Module(_)
                    | Parent::File
                    | Parent::None => break None,
                    // The name of a member of an object literal is part of what is around the literal. That of a member of a class
                    // has a rule of its own.
                    Parent::Key(_) | Parent::MemberKey => match hir
                        .props
                        .iter()
                        .position(|p| p.key == PropKey::Computed(top))
                    {
                        Some(p) => parent = Parent::Expr(bound.prop_owner[p]),
                        None => break None,
                    },
                    Parent::Stmt(s) if s.is_none() => break None,
                    Parent::Expr(x) => {
                        top = x;
                        parent = bound.expr_parent[x.idx()];
                    }
                    other => parent = self.outward(file, other),
                }
            };
            if let Some(m) = container
                && hir[m].flags.contains(Flags::STATIC)
                && let MemberOwner::Class(c) = bound.member_owner[m.idx()]
                && hir
                    .decorators
                    .iter()
                    .any(|d| d.0 == DecoratorOwner::Class(c))
            {
                out.push(Diagnostic {
                    start: hir.exprs[i].pos,
                    code: 2816,
                });
            }
        }
    }
}
