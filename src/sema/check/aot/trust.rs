use crate::atom::{Atom, SYMBOL_NAME_PREFIX, known};
use crate::bind::{Decl, MemberOwner, Parent, PatParent, SymFlags};
use crate::check::Checker;
use super::builtins_generated::BUILTINS;
use super::storage::Query;
use crate::hir::{BinOp, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, MemberKind, VarKind};
use crate::program::{FileId, Sym};
use crate::types::{MapperId, Prop, PropFlags, PropSource, TypeData, TypeId};
use crate::util::{FxHashMap, FxHashSet};

const GLOBAL_VALUES: &[&str] = &["undefined", "NaN", "Infinity", "globalThis"];

pub(super) const ALIASES: &[(&str, &str)] = &[
    ("ReadonlyArray", "Array"),
    ("ConcatArray", "Array"),
    ("TemplateStringsArray", "Array"),
    ("RegExpMatchArray", "Array"),
    ("RegExpExecArray", "Array"),
    ("ReadonlyMap", "Map"),
    ("ReadonlySet", "Set"),
    ("ReadonlySetLike", "Set"),
    ("CallableFunction", "Function"),
    ("NewableFunction", "Function"),
    ("PromiseLike", "Promise"),
    ("Console", "console"),
    ("IteratorObject", "Iterator"),
    ("IterableIterator", "Iterator"),
    ("ArrayIterator", "Iterator"),
    ("MapIterator", "Iterator"),
    ("SetIterator", "Iterator"),
    ("StringIterator", "Iterator"),
    ("RegExpStringIterator", "Iterator"),
    ("Generator", "Iterator"),
    ("Iterator", "Iterator"),
];

pub(super) const TYPED_ARRAYS: &[&str] = &[
    "Int8Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Int16Array",
    "Uint16Array",
    "Int32Array",
    "Uint32Array",
    "Float16Array",
    "Float32Array",
    "Float64Array",
    "BigInt64Array",
    "BigUint64Array",
];

fn names_of(holder: &[u8]) -> Option<&'static FxHashSet<&'static [u8]>> {
    static NAMES_BY_HOLDER: std::sync::OnceLock<FxHashMap<&'static [u8], FxHashSet<&'static [u8]>>> = std::sync::OnceLock::new();
    let names_by_holder = NAMES_BY_HOLDER.get_or_init(|| {
        let mut names_by_holder: FxHashMap<&'static [u8], FxHashSet<&'static [u8]>> = FxHashMap::default();
        for entry in BUILTINS {
            names_by_holder.entry(entry.0.as_bytes()).or_insert_with(|| entry.1.split(' ').map(str::as_bytes).collect());
        }
        names_by_holder
    });
    names_by_holder.get(holder)
}

fn has_entry(holder: &[u8], name: &[u8]) -> bool {
    names_of(holder).is_some_and(|names| names.contains(name))
}

pub fn is_engine_global(name: &[u8]) -> bool {
    has_entry(b"", name) || names_of(name).is_some() || GLOBAL_VALUES.iter().chain(TYPED_ARRAYS).any(|known| known.as_bytes() == name)
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum Claim {
    Binding,
    Call,
    GenericCall,
    GenericCallWithTypeArguments,
    New,
    Property,
    Await,
}

impl Claim {
    const ALL: [Claim; 7] = [Claim::Binding, Claim::Call, Claim::GenericCall, Claim::GenericCallWithTypeArguments, Claim::New, Claim::Property, Claim::Await];

    fn encode(claim: Option<Claim>) -> u64 {
        claim.map_or(0, |claim| Claim::ALL.iter().position(|&it| it == claim).map_or(0, |at| at as u64 + 1))
    }

    fn decode(encoded: u64) -> Option<Claim> {
        encoded.checked_sub(1).and_then(|at| Claim::ALL.get(at as usize).copied())
    }

    pub fn text(self) -> &'static str {
        match self {
            Claim::Binding => "binding",
            Claim::Call => "call",
            Claim::GenericCall => "generic call",
            Claim::GenericCallWithTypeArguments => "generic call with type arguments",
            Claim::New => "new",
            Claim::Property => "property",
            Claim::Await => "await",
        }
    }
}

#[derive(Copy, Clone)]
enum SymbolClaim {
    IsAmbient,
    HasUnknownFields,
    None,
}

#[derive(Default)]
pub(super) struct State {
    claims: super::ByExpression<Option<Claim>>,
    ambient: FxHashMap<Sym, bool>,
    of_symbols: FxHashMap<Sym, SymbolClaim>,
    of_properties: FxHashMap<(TypeId, Atom), bool>,
    widened_by_store_cache: FxHashMap<(TypeId, Atom), bool>,
    mistyped_computed_key_stores: Option<std::rc::Rc<FxHashMap<Atom, Vec<TypeId>>>>,
    external_assignment_cache: FxHashMap<(TypeId, Atom), bool>,
    unknown_elements_cache: FxHashMap<(TypeId, Atom), bool>,
    literal_spreads: Option<((FileId, ExprId), std::rc::Rc<[crate::hir::PropId]>)>,
}

impl State {
    pub(super) fn enable_expr_cache_for(&mut self, file: FileId, expressions: usize) {
        self.claims.switch_to_file(file, expressions, None);
    }
}

impl<'p, 's> Checker<'p, 's> {
    pub fn unverified_claim(&mut self, file: FileId, e: ExprId) -> Option<Claim> {
        if !matches!(
            self.hir(file)[e].kind,
            ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_) | ExprKind::TaggedTemplate(_) | ExprKind::New(_) | ExprKind::Await(_) | ExprKind::ImportCall { .. }
        ) {
            return None;
        }
        if let Some(&known) = self.aot.trust.claims.get((file, e)) {
            return known;
        }
        if let Some(assumed) = self.assumption(Query::Claim(file, e)) {
            return Claim::decode(assumed);
        }
        let predicted = Claim::encode(Some(match self.hir(file)[e].kind {
            ExprKind::Ident(_) => Claim::Binding,
            ExprKind::New(_) => Claim::New,
            ExprKind::Await(_) => Claim::Await,
            ExprKind::Dot { .. } | ExprKind::Index { .. } => Claim::Property,
            _ => Claim::Call,
        }));
        let (found, is_final) = self.solve(Query::Claim(file, e), Claim::encode(None), predicted, |c| Claim::encode(c.find_unverified_claim(file, e)));
        let found = Claim::decode(found);
        if is_final {
            self.aot.trust.claims.insert((file, e), found);
        }
        found
    }

    pub fn is_predicted(&mut self, file: FileId, e: ExprId) -> bool {
        if let ExprKind::NonNull(asserted) = self.hir(file)[e].kind {
            return self.is_predicted(file, asserted);
        }
        let produced = self.result_type_of(file, e);
        self.is_uninformative(produced) && {
            let checked = self.type_of_expr(file, e);
            !self.is_uninformative(checked)
        }
    }

    fn find_unverified_claim(&mut self, file: FileId, e: ExprId) -> Option<Claim> {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Ident(name) => {
                let sym = self.symbol_of_identifier(file, e, name)?;
                let sym = if self.files.flags(sym).contains(SymFlags::ALIAS) { self.files.resolve_alias(sym)? } else { sym };
                match self.symbol_claim(sym) {
                    SymbolClaim::IsAmbient => Some(Claim::Binding),
                    SymbolClaim::HasUnknownFields => self.is_narrowed_from_untyped(file, e, sym).then_some(Claim::Binding),
                    SymbolClaim::None => None,
                }
            }
            ExprKind::Dot { obj, name, .. } => {
                if matches!(hir[obj].kind, ExprKind::Super) {
                    return None;
                }
                let receiver = self.type_of_expr(file, obj);
                (self.is_predicted(file, obj) || self.is_property_claimed(receiver, name) || self.is_class_prototype_object(file, e, name) || self.has_ambient_index_signature(receiver) || self.is_primitive_read_after_cast(file, e)).then_some(Claim::Property)
            }
            ExprKind::Index { obj, index, .. } => {
                if self.is_predicted(file, obj) {
                    return Some(Claim::Property);
                }
                let receiver = self.type_of_expr(file, obj);
                if let Some(name) = self.property_named_by_constant_symbol(file, index)
                    && self.is_property_claimed(receiver, name)
                {
                    return Some(Claim::Property);
                }
                let is_listed_there = matches!(hir[index].kind, ExprKind::String(name) if self.has_ambient_class_member(receiver, name) || self.is_class_prototype_object(file, e, name));
                (is_listed_there || self.has_ambient_index_signature(receiver)).then_some(Claim::Property)
            }
            ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => {
                let callee = hir[call].callee;
                if matches!(self.validation_call(file, e), Some((super::ValidationCall::Validate | super::ValidationCall::SafeValidate | super::ValidationCall::Parse, _))) {
                    return None;
                }
                if self.is_allocated_by_subclass_constructor(file, e, callee) {
                    return Some(Claim::Call);
                }
                if self.redefines_literal(file, e)
                    || self.returned_argument_of(file, e).is_some_and(|first| self.is_predicted(file, first))
                    || self.returned_argument_of_function(file, e).is_some_and(|handed| self.is_argument_returned_by_call(file, handed) && self.is_parameter_type_inferred_from_arguments(file, handed) && self.is_predicted(file, handed))
                {
                    return Some(Claim::Call);
                }
                if matches!(hir[callee].kind, ExprKind::Super) {
                    return None;
                }
                let is_generic = match self.resolved_signature(file, e).sig {
                    Some(sig) => self.sig_decl(sig).is_some_and(|(of, func, _)| self.return_type_of_fn(of, func) != self.sig_return(sig)),
                    None => false,
                };
                if is_generic && self.resolves_to_type_with_return_only_type_parameter(file, e) {
                    return Some(if hir[call].type_args.is_empty() { Claim::GenericCall } else { Claim::GenericCallWithTypeArguments });
                }
                if let ExprKind::Dot { obj, name, .. } = hir[callee].kind
                    && self.atoms().bytes(name) == b"resolve"
                    && self.refers_to_global_object(file, obj, b"Promise")
                    && hir.ids(hir[call].args).next().is_some_and(|resolved| self.may_be_thenable(file, resolved))
                {
                    return Some(Claim::GenericCall);
                }
                if self.returns_unchecked_promise(file, e, callee) {
                    return Some(if is_generic { Claim::GenericCall } else { Claim::Call });
                }
                if is_generic && hir[call].type_args.is_empty() && self.enumerates_property_values(file, callee) {
                    return Some(Claim::GenericCall);
                }
                if !self.is_predicted(file, callee) {
                    if let Some((of, declared, _)) = self.resolved_signature(file, e).sig.and_then(|sig| self.sig_decl(sig))
                        && self.is_ambient_function_declaration(of, declared)
                    {
                        return Some(if is_generic { Claim::GenericCall } else { Claim::Call });
                    }
                    let is_declared_by_lib = self.resolved_signature(file, e).sig.and_then(|sig| self.sig_decl(sig)).is_some_and(|(of, ..)| self.files.module(of).is_lib);
                    let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
                    return (is_generic
                        && arguments.into_iter().any(|argument| {
                            is_declared_by_lib && (self.holds_prediction(file, argument) || self.spreads_unnamed_members(file, argument)) || matches!(hir[argument].kind, ExprKind::Fn(func) if self.is_callback_typed_by_own_prediction(file, func))
                        }))
                    .then_some(Claim::GenericCall);
                }
                Some(match (is_generic, hir[call].type_args.is_empty()) {
                    (false, _) => Claim::Call,
                    (true, true) => Claim::GenericCall,
                    (true, false) => Claim::GenericCallWithTypeArguments,
                })
            }
            ExprKind::New(call) => self.is_predicted(file, hir[call].callee).then_some(Claim::New),
            ExprKind::Await(operand) => (self.is_predicted(file, operand) || self.is_promise_of_prediction(file, operand) || self.may_be_thenable(file, operand)).then_some(Claim::Await),
            ExprKind::ImportCall { args } => {
                let ExprKind::String(specifier) = hir[hir.id_at(args, 0)].kind else { return None };
                let module = self.files.module_of_specifier_as(file, specifier, self.files.mode_of_import_call(file))?;
                self.is_ambient_value(module).then_some(Claim::Call)
            }
            _ => None,
        }
    }

    pub(super) fn is_primitive_read_after_cast(&mut self, file: FileId, e: ExprId) -> bool {
        let ExprKind::Dot { obj, .. } = self.hir(file)[e].kind else { return false };
        if !self.is_primitive_by_type(file, e) {
            return false;
        }
        let known = self.result_type_of(file, obj);
        known != self.type_of_expr(file, obj) && !self.is_uninformative(known) && !self.is_primitive_by_type(file, obj)
    }

    fn is_class_prototype_object(&mut self, file: FileId, e: ExprId, name: Atom) -> bool {
        name == known::prototype && {
            let declared = self.type_of_expr(file, e);
            self.is_instance_type(declared)
        }
    }

    fn enumerates_property_values(&mut self, file: FileId, callee: ExprId) -> bool {
        let ExprKind::Dot { obj, name, .. } = self.hir(file)[callee].kind else { return false };
        matches!(self.atoms().bytes(name), b"values" | b"entries") && self.refers_to_global_object(file, obj, b"Object")
    }

    fn is_host_global(&mut self, receiver: TypeId, name: Atom) -> bool {
        if !matches!(self.data(receiver), TypeData::Anon { origin: crate::types::Origin::GlobalThis, .. }) {
            return false;
        }
        let Some(members) = self.members(receiver) else { return false };
        let Some(prop) = members.resolved.prop(name) else { return false };
        let PropSource::Symbol(declared) = prop.source else { return false };
        self.is_ambient_value(declared) && !self.is_builtin_global(declared)
    }

    fn is_allocated_by_subclass_constructor(&mut self, file: FileId, e: ExprId, callee: ExprId) -> bool {
        let ExprKind::Dot { obj, .. } = self.hir(file)[callee].kind else { return false };
        let is_declared_by_lib = self.resolved_signature(file, e).sig.and_then(|sig| self.sig_decl(sig)).is_some_and(|(of, ..)| self.files.module(of).is_lib);
        if !is_declared_by_lib || matches!(self.hir(file)[obj].kind, ExprKind::Super) {
            return false;
        }
        let produced = self.type_of_expr(file, e);
        if !self.parts(produced).iter().copied().any(|part| self.is_object_type(part)) {
            return false;
        }
        let receiver = self.type_of_expr(file, obj);
        let receiver = self.non_nullable(receiver);
        self.parts(receiver).iter().copied().any(|part| {
            let Some((of, class)) = self.class_for_type(part, false).or_else(|| self.class_for_type(part, true)) else { return false };
            let instances = self.class_instance_type(of, class);
            self.is_array_like(instances) || self.extended_built_in(instances).is_some()
        })
    }

    fn symbol_claim(&mut self, sym: Sym) -> SymbolClaim {
        if let Some(&known) = self.aot.trust.of_symbols.get(&sym) {
            return known;
        }
        let (asked, is_settled) = (self.begin_query(), !self.results_are_provisional());
        let found = if self.is_ambient_value(sym) && !self.is_builtin_global(sym) {
            SymbolClaim::IsAmbient
        } else if self.declared_type_has_unknown_fields(sym) {
            SymbolClaim::HasUnknownFields
        } else {
            SymbolClaim::None
        };
        if self.is_assumption_free(asked) && is_settled {
            self.aot.trust.of_symbols.insert(sym, found);
        }
        found
    }

    fn is_property_claimed(&mut self, receiver: TypeId, name: Atom) -> bool {
        if let Some(&known) = self.aot.trust.of_properties.get(&(receiver, name)) {
            return known;
        }
        let (asked, is_settled) = (self.begin_query(), !self.results_are_provisional());
        let found = self.is_unlisted_property(receiver, name)
            || self.has_predicted_prop(receiver, name)
            || self.has_ambient_class_member(receiver, name)
            || self.is_host_global(receiver, name)
            || self.is_property_of_every_object(receiver, name);
        if self.is_assumption_free(asked) && is_settled {
            self.aot.trust.of_properties.insert((receiver, name), found);
        }
        found
    }

    fn is_property_of_every_object(&mut self, receiver: TypeId, name: Atom) -> bool {
        let Some(object) = self.global_type_symbol(known::Object) else { return false };
        let receiver = self.non_nullable(receiver);
        self.parts(receiver).to_vec().into_iter().any(|part| match self.get_property_of_type(part, name) {
            Some((&Prop { source: PropSource::Symbol(declared), flags, .. }, _)) => !flags.contains(PropFlags::METHOD) && self.files.parent_of_symbol(declared) == Some(object),
            _ => false,
        })
    }

    fn declared_type_has_unknown_fields(&mut self, sym: Sym) -> bool {
        let is_constant = matches!(self.variable_declaration(sym), Some((of, Decl::Var(pat))) if matches!(self.bound(of).pat_parent[pat.idx()], PatParent::Var(d) if self.hir(of)[d].kind == VarKind::Const));
        if !is_constant && !(self.is_annotated(sym) && matches!(self.variable_declaration(sym), Some((_, Decl::Var(_) | Decl::Param(_))))) {
            return false;
        }
        let declared = self.type_of_symbol(sym);
        self.parts(declared).iter().copied().all(|part| {
            part.is_any() || matches!(part, TypeId::UNKNOWN | TypeId::OBJECT | TypeId::UNDEFINED | TypeId::NULL) || !self.is_instantiable(part) && (self.is_empty_object_type(part) || self.has_unknown_fields(part))
        })
    }

    fn is_narrowed_from_untyped(&mut self, file: FileId, e: ExprId, sym: Sym) -> bool {
        let declared = self.type_of_symbol(sym);
        let narrowed = self.type_of_expr(file, e);
        narrowed != declared && !self.is_uninformative(narrowed) && self.parts(narrowed).iter().copied().any(|part| self.is_array_or_tuple(part) || self.declares_properties(part) && self.extended_built_in(part).is_none() && self.array_subtype_element(part).is_none())
    }

    fn resolves_to_type_with_return_only_type_parameter(&mut self, file: FileId, call: ExprId) -> bool {
        let Some((of, func, _)) = self.resolved_signature(file, call).sig.and_then(|sig| self.sig_decl(sig)) else { return false };
        if self.files.module(of).is_lib {
            return false;
        }
        let returned = self.return_type_of_fn(of, func);
        let resolved = if self.is_iterable_declared_by_lib(returned) { Some(returned) } else { self.awaited_no_alias(returned).filter(|&resolved| resolved != returned) };
        let Some(resolved) = resolved else { return false };
        let declared = self.sig_of_fn(of, func);
        let type_parameters = self.sig_type_params(declared);
        let parameters = self.sig_params(declared);
        type_parameters.iter().any(|&type_parameter| {
            let mapper = self.mapper_from(&[type_parameter], &[TypeId::UNKNOWN]);
            self.instantiate(resolved, mapper) != resolved && !parameters.iter().any(|parameter| self.instantiate(parameter.ty, mapper) != parameter.ty)
        })
    }

    fn is_iterable_declared_by_lib(&self, ty: TypeId) -> bool {
        const NAMES: [Atom; 8] = [known::Iterable, known::Iterator, known::IterableIterator, known::Generator, known::AsyncIterable, known::AsyncIterator, known::AsyncIterableIterator, known::AsyncGenerator];
        matches!(self.data(ty), TypeData::Ref { target, .. } if self.files.module(target.file).is_lib && NAMES.contains(&self.files.symbol(*target).name))
    }

    fn returns_unchecked_promise(&mut self, file: FileId, call: ExprId, callee: ExprId) -> bool {
        let Some(sig) = self.resolved_signature(file, call).sig else { return false };
        let promise = self.sig_return(sig);
        let Some(resolved) = self.awaited_no_alias(promise).filter(|&resolved| resolved != promise) else { return false };
        if self.is_uninformative(resolved) {
            return false;
        }
        let declaration = self.sig_decl(sig).map(|(of, func, _)| (of, func)).filter(|&(of, func)| !matches!(self.hir(of)[func].body, FnBody::None));
        let Some((of, func)) = declaration.or_else(|| self.function_for_value_expr(file, callee)) else { return false };
        let flags = self.hir(of)[func].flags;
        if self.files.module(of).is_lib || flags.contains(Flags::GENERATOR) {
            return false;
        }
        let values: Vec<ExprId> = self.returned_values(of, func).into_iter().filter(|value| value.is_some()).collect();
        if flags.contains(Flags::ASYNC) {
            let declared = self.return_type_of_fn(of, func);
            return self.has_type_variables(declared)
                && (self.returned_forced_cast_operand(file, call).is_some_and(|operand| self.has_unknown_fields(operand)) || values.into_iter().any(|value| self.is_predicted(of, value)));
        }
        values.into_iter().any(|value| {
            self.is_predicted(of, value) || self.is_promise_of_prediction(of, value) || {
                let own = self.type_of_expr(of, value);
                let resolved = self.awaited(own);
                resolved != own && self.is_uninformative(resolved)
            }
        })
    }

    fn holds_prediction(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Missing => false,
            ExprKind::Array(elements) => hir.ids(elements).collect::<Vec<ExprId>>().into_iter().any(|element| self.holds_prediction(file, element)),
            ExprKind::Spread(spread) => self.holds_prediction(file, spread),
            ExprKind::Ident(name) => self.is_predicted(file, e) || self.const_array_literal(file, e, name).is_some_and(|(of, literal)| self.holds_prediction(of, literal)),
            _ => self.is_predicted(file, e),
        }
    }

    fn const_array_literal(&mut self, file: FileId, e: ExprId, name: Atom) -> Option<(FileId, ExprId)> {
        let sym = self.symbol_of_identifier(file, e, name)?;
        let Some((of, Decl::Var(pat))) = self.variable_declaration(sym) else { return None };
        let PatParent::Var(d) = self.bound(of).pat_parent[pat.idx()] else { return None };
        let declared = &self.hir(of)[d];
        (declared.kind == VarKind::Const && declared.pat == pat && declared.init.is_some() && matches!(self.hir(of)[declared.init].kind, ExprKind::Array(_))).then_some((of, declared.init))
    }

    fn may_be_thenable(&mut self, file: FileId, e: ExprId) -> bool {
        let written = self.type_of_expr(file, e);
        self.parts(written).iter().any(|&part| self.is_object_type(part) && !self.is_thenable(part))
    }

    fn is_promise_of_prediction(&mut self, file: FileId, e: ExprId) -> bool {
        let produced = self.result_type_of(file, e);
        if produced == self.type_of_expr(file, e) {
            return false;
        }
        let promised = self.awaited(produced);
        self.is_uninformative(promised)
    }

    fn is_ambient_function_declaration(&mut self, of: FileId, declared: FnId) -> bool {
        if self.hir(of)[declared].kind != FnKind::Decl {
            return false;
        }
        let symbol = self.bound(of).symbol_of_declaration(Decl::Fn(declared));
        if symbol.is_none() {
            return false;
        }
        let sym = self.files.sym(of, symbol);
        self.is_ambient_value(sym) && !self.is_builtin_global(sym)
    }

    fn is_ambient_value(&mut self, sym: Sym) -> bool {
        if let Some(&known) = self.aot.trust.ambient.get(&sym) {
            return known;
        }
        let mut has_value = false;
        let mut is_ambient = true;
        for &(file, decl) in self.files.decls_of(sym).iter() {
            let hir = self.hir(file);
            let has_code = match decl {
                Decl::Fn(f) => !matches!(hir[f].body, FnBody::None),
                Decl::Var(_) | Decl::Class(_) | Decl::Module(_) => !hir.is_ambient(hir.node(decl)),
                Decl::File => true,
                Decl::Interface(_) | Decl::Alias(_) | Decl::TypeParam(_) => continue,
                _ => true,
            };
            has_value = true;
            is_ambient &= !has_code || self.is_declaration_only(file);
        }
        let found = has_value && is_ambient;
        self.aot.trust.ambient.insert(sym, found);
        found
    }

    fn is_builtin_global(&self, sym: Sym) -> bool {
        let name = self.files.symbol(sym).name;
        if name.is_none() || self.files.parent_of_symbol(sym).is_some() {
            return false;
        }
        is_engine_global(self.atoms().bytes(name))
    }

    fn is_unlisted_property(&mut self, receiver: TypeId, name: Atom) -> bool {
        let receiver = self.non_nullable(receiver);
        let parts: &[TypeId] = self.parts(receiver);
        parts.iter().copied().any(|part| {
            let apparent = self.apparent_type(part);
            let Some(members) = self.members(apparent) else { return false };
            let Some(prop) = members.resolved.prop(name) else { return false };
            let PropSource::Symbol(declared) = prop.source else { return false };
            self.files.module(declared.file).is_lib && self.declaring_container_name(declared).is_some_and(|holder| !self.is_listed(holder, name))
        })
    }

    pub fn is_guaranteed_by_engine(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let (obj, name) = match hir[e].kind {
            ExprKind::Dot { obj, name, .. } => (obj, name),
            ExprKind::Call(call) => {
                let ExprKind::Dot { obj, name, .. } = hir[hir[call].callee].kind else { return false };
                let Some(sig) = self.resolved_signature(file, e).sig else { return false };
                let Some((of, func, _)) = self.sig_decl(sig) else { return false };
                if !self.files.module(of).is_lib || self.return_type_of_fn(of, func) != self.sig_return(sig) {
                    return false;
                }
                (obj, name)
            }
            _ => return false,
        };
        let receiver = self.type_of_expr(file, obj);
        let receiver = self.non_nullable(receiver);
        let parts: &[TypeId] = self.parts(receiver);
        !parts.is_empty()
            && parts.iter().copied().all(|part| {
                let apparent = self.apparent_type(part);
                let Some(members) = self.members(apparent) else { return false };
                let Some(prop) = members.resolved.prop(name) else { return false };
                let PropSource::Symbol(declared) = prop.source else { return false };
                self.files.module(declared.file).is_lib && self.declaring_container_name(declared).is_some_and(|holder| self.is_engine_holder(holder) && self.is_listed(holder, name))
            })
    }

    fn is_engine_holder(&self, holder: Atom) -> bool {
        let holder = self.atoms().bytes(holder);
        let holder = holder.strip_suffix(b"Constructor").filter(|rest| !rest.is_empty()).unwrap_or(holder);
        let holder = ALIASES.iter().find(|alias| alias.0.as_bytes() == holder).map_or(holder, |alias| alias.1.as_bytes());
        names_of(holder).is_some() || TYPED_ARRAYS.iter().any(|known| known.as_bytes() == holder)
    }

    fn getter_returns_external_data(&mut self, prop: &Prop) -> bool {
        let getter = match Self::written_member_behind(prop).map_or(&prop.source, |written| &written.source) {
            &PropSource::Literal(file, declared) if self.hir(file)[declared].kind == crate::hir::PropKind::Getter => match self.hir(file)[self.hir(file)[declared].value].kind {
                ExprKind::Fn(func) => (file, func),
                _ => return false,
            },
            &PropSource::Symbol(accessor) => match self.files().value_declaration(accessor) {
                Some((file, Decl::Member(member))) if self.hir(file)[member].kind == MemberKind::Getter => (file, self.hir(file)[member].func),
                _ => return false,
            },
            _ => return false,
        };
        getter.1.is_some() && self.hir(getter.0)[getter.1].ret.is_none() && self.is_compiled(getter.0) && !self.is_untyped_file(getter.0) && self.function_returns_external_data(getter.0, getter.1)
    }

    pub fn is_prop_predicted(&mut self, prop: &Prop) -> bool {
        if self.getter_returns_external_data(prop) {
            return true;
        }
        let Some(&Prop { source: PropSource::Literal(file, declared), .. }) = Self::written_member_behind(prop) else { return false };
        let value = self.hir(file)[declared].value;
        value.is_some() && self.is_predicted(file, value) || self.is_inferred_from_first_value(prop) || self.may_be_overridden_by_spread(file, declared)
    }

    fn spreads_unnamed_members(&mut self, file: FileId, literal: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Object(props) = hir[literal].kind else { return false };
        let sources: Vec<ExprId> = props.iter().filter(|&p| hir[p].kind == crate::hir::PropKind::Spread).map(|p| hir[p].value).collect();
        sources.into_iter().any(|source| {
            let spread = self.type_of_expr(file, source);
            let spread = self.non_nullable(spread);
            let parts: &[TypeId] = self.parts(spread);
            parts.iter().copied().any(|part| self.is_untyped_for_objects(part) || self.is_instantiable(part) || self.members(part).is_some_and(|members| !members.shape().index.is_empty()))
        })
    }

    fn may_be_overridden_by_spread(&mut self, file: FileId, declared: crate::hir::PropId) -> bool {
        let hir = self.hir(file);
        let owner = self.bound(file).prop_owner[declared.idx()];
        if owner.is_none() {
            return false;
        }
        let ExprKind::Object(props) = hir[owner].kind else { return false };
        let known = self.aot.trust.literal_spreads.as_ref().filter(|known| known.0 == (file, owner)).map(|known| std::rc::Rc::clone(&known.1));
        let spreads = match known {
            Some(spreads) => spreads,
            None => {
                let spreads: std::rc::Rc<[crate::hir::PropId]> = props.iter().filter(|&p| hir[p].kind == crate::hir::PropKind::Spread).collect();
                self.aot.trust.literal_spreads = Some(((file, owner), std::rc::Rc::clone(&spreads)));
                spreads
            }
        };
        let behind: Vec<ExprId> = spreads.iter().filter(|p| p.0 >= declared.0).map(|&p| hir[p].value).collect();
        behind.into_iter().any(|source| {
            let spread = self.type_of_expr(file, source);
            let spread = self.non_nullable(spread);
            let parts: &[TypeId] = self.parts(spread);
            parts.iter().copied().any(|part| self.is_untyped_for_objects(part) || self.is_instantiable(part) || self.members(part).is_some_and(|members| !members.shape().index.is_empty()))
        })
    }

    fn written_member_behind<'a, 'b>(prop: &'a Prop<'b>) -> Option<&'a Prop<'b>> {
        match &prop.source {
            PropSource::Literal(..) => Some(prop),
            PropSource::Copy(_, declaring, _) | PropSource::Mapped(_, _, Some(declaring)) => match &declaring[..] {
                [only @ Prop { source: PropSource::Literal(..), .. }] => Some(only),
                _ => None,
            },
            _ => None,
        }
    }

    fn is_inferred_from_first_value(&mut self, prop: &Prop) -> bool {
        let is_declared_readonly = match prop.source {
            PropSource::Mapped(..) => Self::written_member_behind(prop).is_none_or(|written| written.flags.contains(PropFlags::READONLY)),
            _ => prop.flags.contains(PropFlags::READONLY),
        };
        if is_declared_readonly || prop.flags.intersects(PropFlags::METHOD | PropFlags::ACCESSOR) {
            return false;
        }
        let held = self.type_of_prop(prop, MapperId::IDENTITY);
        let parts: &[TypeId] = self.parts(held);
        parts.iter().all(|&part| self.is_nullish(part)) || parts.len() == 1 && matches!(self.data(parts[0]), TypeData::BoolLit { .. } | TypeData::NumberLit { .. } | TypeData::StringLit { .. } | TypeData::BigIntLit { .. })
    }

    fn has_ambient_index_signature(&mut self, ty: TypeId) -> bool {
        let ty = self.non_nullable(ty);
        let parts: &[TypeId] = self.parts(ty);
        parts.iter().copied().any(|part| {
            let declared_in: Vec<FileId> = self.members(part).map_or(Vec::new(), |members| members.shape().index.iter().filter_map(|info| info.declaration.map(|declaration| declaration.0)).collect());
            declared_in.into_iter().any(|of| self.is_declaration_only(of) && !self.files.module(of).is_lib)
        })
    }

    pub(super) fn has_predicted_prop(&mut self, ty: TypeId, name: Atom) -> bool {
        let ty = self.non_nullable(ty);
        let ty = if matches!(self.data(ty), TypeData::ThisParam(_)) { self.apparent_type(ty) } else { ty };
        let parts: &[TypeId] = self.parts(ty);
        parts.iter().copied().any(|part| {
            let Some(members) = self.members(part) else { return false };
            members.resolved.prop(name).is_some_and(|prop| self.is_prop_predicted(prop)) || self.is_predicted_through_spread(part, name) || self.is_widened_by_checked_source_store(part, name)
        })
    }

    fn is_inferred_property_assigned_external_data(&mut self, holder: TypeId, name: Atom) -> bool {
        if let Some(&known) = self.aot.trust.external_assignment_cache.get(&(holder, name)) {
            return known;
        }
        self.aot.trust.external_assignment_cache.insert((holder, name), false);
        let found = self.find_external_assignment(holder, name);
        self.aot.trust.external_assignment_cache.insert((holder, name), found);
        found
    }

    fn is_same_declared_property(&mut self, prop: &Prop, holder: TypeId, receiver: TypeId, name: Atom) -> bool {
        receiver == holder
            || self.members(receiver).and_then(|members| members.resolved.prop(name)).is_some_and(|assigned| {
                match (Self::written_member_behind(prop).map_or(&prop.source, |written| &written.source), Self::written_member_behind(assigned).map_or(&assigned.source, |written| &written.source)) {
                    (PropSource::Literal(file, property), PropSource::Literal(other_file, other_property)) => file == other_file && property == other_property,
                    (PropSource::Symbol(field), PropSource::Symbol(other_field)) => field == other_field,
                    _ => false,
                }
            })
    }

    pub(super) fn property_holds_unknown_elements(&mut self, holder: TypeId, name: Atom) -> bool {
        if let Some(&known) = self.aot.trust.unknown_elements_cache.get(&(holder, name)) {
            return known;
        }
        self.aot.trust.unknown_elements_cache.insert((holder, name), false);
        let found = self.find_property_with_unknown_elements(holder, name);
        self.aot.trust.unknown_elements_cache.insert((holder, name), found);
        found
    }

    fn find_property_with_unknown_elements(&mut self, holder: TypeId, name: Atom) -> bool {
        let Some(members) = self.members(holder) else { return false };
        let Some(prop) = members.resolved.prop(name) else { return false };
        let Some(declared) = self.type_of_property(holder, name) else { return false };
        if !self.is_container(declared) || !self.has_primitive_elements(declared) {
            return false;
        }
        let initializer = match Self::written_member_behind(prop) {
            Some(&Prop { source: PropSource::Literal(file, written), .. }) => (file, self.hir(file)[written].value),
            _ => {
                let PropSource::Symbol(field) = prop.source else { return false };
                match self.files().value_declaration(field) {
                    Some((file, Decl::Member(member))) if self.hir(file)[member].kind == MemberKind::Property && self.hir(file)[member].ty.is_none() => (file, self.hir(file)[member].init),
                    _ => return false,
                }
            }
        };
        if self.holds_unknown_elements(initializer.0, initializer.1) {
            return true;
        }
        if let Some(assignments) = self.property_assignments().get(&name) {
            for &(file, assignment) in assignments {
                let hir = self.hir(file);
                let ExprKind::Assign { target, value, .. } = hir[assignment].kind else { continue };
                let ExprKind::Dot { obj, .. } = hir[target].kind else { continue };
                if self.is_property_of(prop, holder, file, obj, name) && self.holds_unknown_elements(file, value) {
                    return true;
                }
            }
        }
        if let Some(mutations) = self.property_container_mutations().get(&name) {
            for &(file, obj, value) in mutations {
                if self.is_property_of(prop, holder, file, obj, name) && self.is_external_element(file, value) {
                    return true;
                }
            }
        }
        false
    }

    fn is_property_of(&mut self, prop: &Prop, holder: TypeId, file: FileId, obj: ExprId, name: Atom) -> bool {
        let receiver = self.type_of_expr(file, obj);
        let receiver = self.non_nullable(receiver);
        let receiver = self.apparent_type(receiver);
        self.is_same_declared_property(prop, holder, receiver, name)
    }

    fn find_external_assignment(&mut self, holder: TypeId, name: Atom) -> bool {
        let Some(members) = self.members(holder) else { return false };
        let Some(prop) = members.resolved.prop(name) else { return false };
        let Some(declared) = self.type_of_property(holder, name) else { return false };
        if !self.every_type(declared, |c, part| c.is_primitive(part)) {
            return false;
        }
        if Self::written_member_behind(prop).is_none() {
            let PropSource::Symbol(field) = prop.source else { return false };
            let initializer = match self.files().value_declaration(field) {
                Some((file, Decl::Member(member))) if self.hir(file)[member].kind == MemberKind::Property && self.hir(file)[member].ty.is_none() => (file, self.hir(file)[member].init),
                Some((file, Decl::ParameterProperty(parameter))) if self.hir(file)[parameter].ty.is_none() => (file, self.hir(file)[parameter].default),
                _ => return false,
            };
            if initializer.1.is_some() && self.is_derived_from_prediction(initializer.0, initializer.1, 0) {
                return true;
            }
            if let Some((file, Decl::ParameterProperty(parameter))) = self.files().value_declaration(field)
                && self.parameter_receives_external_data(file, parameter)
            {
                return true;
            }
        }
        let Some(assignments) = self.property_assignments().get(&name) else { return false };
        for &(file, assignment) in assignments {
            let hir = self.hir(file);
            let ExprKind::Assign { op, target, value } = hir[assignment].kind else { continue };
            let ExprKind::Dot { obj, .. } = hir[target].kind else { continue };
            let receiver = self.type_of_expr(file, obj);
            let receiver = self.non_nullable(receiver);
            let receiver = self.apparent_type(receiver);
            let is_same_property = self.is_same_declared_property(prop, holder, receiver, name);
            if !is_same_property {
                continue;
            }
            let stored = if matches!(op, None | Some(BinOp::And | BinOp::Or | BinOp::Nullish)) { value } else { assignment };
            if self.is_derived_from_prediction(file, stored, 0) {
                return true;
            }
        }
        false
    }

    fn mistyped_computed_key_stores(&mut self) -> std::rc::Rc<FxHashMap<Atom, Vec<TypeId>>> {
        if let Some(known) = &self.aot.trust.mistyped_computed_key_stores {
            return known.clone();
        }
        let mut found: FxHashMap<Atom, Vec<TypeId>> = FxHashMap::default();
        for &(file, assignment) in self.union_key_assignments() {
            let hir = self.hir(file);
            let ExprKind::Assign { target, .. } = hir[assignment].kind else { continue };
            let ExprKind::Index { obj, index, .. } = hir[target].kind else { continue };
            let key = self.type_of_expr(file, index);
            let names: Vec<Atom> = self.parts(key).iter().filter_map(|&part| match *self.data(part) {
                TypeData::StringLit { value, .. } => Some(value),
                _ => None,
            }).collect();
            if names.len() < 2 || names.len() != self.parts(key).len() {
                continue;
            }
            let receiver = self.type_of_expr(file, obj);
            let receiver = self.non_nullable(receiver);
            let stored = self.type_of_expr(file, assignment);
            if self.is_uninformative(receiver) || self.is_uninformative(stored) {
                continue;
            }
            for name in names {
                let Some(held) = self.type_of_property(receiver, name) else { continue };
                if !self.is_provably_assignable(stored, held) {
                    let receivers = found.entry(name).or_default();
                    if !receivers.contains(&receiver) {
                        receivers.push(receiver);
                    }
                }
            }
        }
        let found = std::rc::Rc::new(found);
        self.aot.trust.mistyped_computed_key_stores = Some(found.clone());
        found
    }

    fn is_widened_by_computed_key_store(&mut self, holder: TypeId, name: Atom) -> bool {
        if self.computed_key_assignments().is_empty() || self.union_key_assignments().is_empty() {
            return false;
        }
        let stores = self.mistyped_computed_key_stores();
        let Some(receivers) = stores.get(&name) else { return false };
        receivers.iter().any(|&receiver| receiver == holder || self.is_provably_assignable(holder, receiver))
    }

    pub fn is_widened_by_checked_source_store(&mut self, holder: TypeId, name: Atom) -> bool {
        if self.is_inferred_property_assigned_external_data(holder, name) || self.is_widened_by_computed_key_store(holder, name) {
            return true;
        }
        let Some(stores) = self.stores_in_checked_sources().and_then(|stores| stores.get(&name)) else { return false };
        if let Some(&known) = self.aot.trust.widened_by_store_cache.get(&(holder, name)) {
            return known;
        }
        self.aot.trust.widened_by_store_cache.insert((holder, name), false);
        let Some(held) = self.type_of_property(holder, name) else { return false };
        if !self.parts(held).iter().copied().all(|part| self.is_nullish(part) || matches!(self.data(part), TypeData::BoolLit { .. })) {
            return false;
        }
        let mut is_so = false;
        for &(text, access) in stores {
            let hir = self.hir(text);
            let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = hir[access].kind else { continue };
            let value = match self.bound(text).expr_parent[access.idx()] {
                Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                    ExprKind::Assign { op: None, target, value } if target == access => Some(value),
                    _ => None,
                },
                _ => None,
            };
            let receiver = self.type_of_expr(text, obj);
            let receiver = self.non_nullable(receiver);
            let stored = match value {
                Some(value) => Some(self.type_of_expr(text, value)),
                None => self.write_type_of_property(receiver, name),
            };
            let is_taken = stored.is_some_and(|stored| !self.is_uninformative(stored) && self.is_provably_assignable(stored, held));
            if !is_taken && (self.is_uninformative(receiver) || self.is_provably_assignable(holder, receiver)) {
                is_so = true;
                break;
            }
        }
        self.aot.trust.widened_by_store_cache.insert((holder, name), is_so);
        is_so
    }

    pub fn is_error_about_ambient_declaration(&mut self, file: FileId, start: u32, end: u32) -> bool {
        let hir = self.hir(file);
        let begins_at_start = |pos: u32| pos <= start && hir.text[pos as usize..start as usize].iter().all(|byte| byte.is_ascii_whitespace());
        let mut expressions: Vec<ExprId> = Vec::new();
        for (e, node) in hir.exprs.iter().enumerate() {
            if node.end != end {
                continue;
            }
            if !begins_at_start(node.pos) {
                if let ExprKind::Dot { obj, .. } = node.kind
                    && hir[obj].end <= start
                {
                    expressions.push(obj);
                }
                continue;
            }
            let e = ExprId(e as u32);
            expressions.push(e);
            if let Parent::Expr(parent) = self.bound(file).expr_parent[e.idx()]
                && parent.is_some()
            {
                match hir[parent].kind {
                    ExprKind::Call(call) | ExprKind::New(call) if hir[call].callee != e => expressions.push(hir[call].callee),
                    ExprKind::Assign { target, value, .. } if target == e => expressions.push(value),
                    _ => {}
                }
            }
        }
        for statement in hir.stmts.iter() {
            if statement.start == start
                && let crate::hir::StmtKind::Return(returned) = statement.kind
                && returned.is_some()
            {
                expressions.push(returned);
            }
        }
        let mut types: Vec<TypeId> = Vec::new();
        for e in expressions {
            types.push(self.type_of_expr(file, e));
        }
        for (node, written) in hir.types.iter().enumerate() {
            if written.end <= end && begins_at_start(written.pos) {
                types.push(self.type_from_node(file, crate::hir::TypeNodeId(node as u32)));
            }
        }
        for (pat, node) in hir.pats.iter().enumerate() {
            if node.end == end
                && begins_at_start(node.pos)
                && let Some(symbol) = self.bound(file).pat_symbol[pat].some()
            {
                types.push(self.type_of_symbol(self.files.sym(file, symbol)));
            }
        }
        let mut seen = FxHashSet::default();
        types.into_iter().any(|ty| self.mentions_ambient_declaration(ty, 0, &mut seen))
    }

    fn is_ambient_declaration_file(&self, file: FileId) -> bool {
        self.is_declaration_only(file) && !self.files.module(file).is_lib
    }

    fn is_prop_declared_ambiently(&self, prop: &Prop) -> bool {
        match &prop.source {
            &PropSource::Symbol(declared) => self.is_ambient_declaration_file(declared.file),
            PropSource::Intersected(_, parts) | PropSource::Mapped(_, _, Some(parts)) | PropSource::Copy(_, parts, _) | PropSource::ReverseMapped(_, parts) => parts.iter().any(|part| self.is_prop_declared_ambiently(part)),
            _ => false,
        }
    }

    fn mentions_ambient_declaration(&mut self, ty: TypeId, depth: u32, seen: &mut FxHashSet<TypeId>) -> bool {
        const MAX_DEPTH: u32 = 4;
        if depth > MAX_DEPTH || !seen.insert(ty) {
            return false;
        }
        use crate::types::Origin;
        let nested: Vec<TypeId> = match self.data(ty) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => parts.to_vec(),
            TypeData::Ref { target, .. } if self.is_ambient_declaration_file(target.file) => return true,
            TypeData::Ref { .. } | TypeData::Tuple { .. } => self.type_arguments(ty).to_vec(),
            TypeData::Fns { decls, .. } => return decls.iter().any(|declaration| self.is_ambient_declaration_file(declaration.0)),
            TypeData::Anon { origin: Origin::ClassStatic(symbol) | Origin::Function(symbol), .. } => return self.is_ambient_declaration_file(symbol.file),
            TypeData::Anon { origin: Origin::TypeLiteral(declared_in, _), .. } if self.is_ambient_declaration_file(*declared_in) => return true,
            TypeData::Anon { origin: Origin::TypeLiteral(..) | Origin::Mapped(..), .. } | TypeData::Synth(_) => {
                return self.members(ty).is_some_and(|members| members.shape().props.iter().any(|prop| self.is_prop_declared_ambiently(prop)));
            }
            &TypeData::IndexedAccess { obj, index, .. } => vec![obj, index],
            &TypeData::Keyof(of) => vec![of],
            _ => return false,
        };
        nested.into_iter().any(|part| self.mentions_ambient_declaration(part, depth + 1, seen))
    }

    pub fn is_predicted_through_spread(&mut self, ty: TypeId, name: Atom) -> bool {
        let TypeData::Synth(shape) = self.data(ty) else { return false };
        let Some((left, right)) = shape.created_from.filter(|_| shape.spread_rank < u32::MAX - 1 && !shape.is_object_rest_type) else { return false };
        let is_optional_in = |c: &mut Self, operand: TypeId| {
            let members = c.members(operand)?;
            Some(members.resolved.prop(name)?.flags.contains(crate::types::PropFlags::OPTIONAL))
        };
        match is_optional_in(self, right) {
            None => self.has_predicted_prop(left, name),
            Some(false) => self.has_predicted_prop(right, name),
            Some(true) => is_optional_in(self, left) == Some(false) || self.has_predicted_prop(right, name) || self.has_predicted_prop(left, name),
        }
    }

    pub(super) fn has_ambient_class_member(&mut self, ty: TypeId, name: Atom) -> bool {
        let ty = self.non_nullable(ty);
        let parts: &[TypeId] = self.parts(ty);
        parts.iter().copied().any(|part| {
            let apparent = self.apparent_type(part);
            self.is_ambient_module_type(part) || !self.is_safe_validate_result_type(part) && self.is_declared_by_ambient_class(apparent, name, 0)
        })
    }

    fn is_ambient_module_type(&mut self, ty: TypeId) -> bool {
        let TypeData::Anon { origin: crate::types::Origin::Module(module) | crate::types::Origin::Namespace { module, .. }, .. } = self.data(ty) else { return false };
        let module = *module;
        self.is_ambient_value(module) && !self.is_builtin_global(module)
    }

    fn is_ambient_member(&self, declared: Sym) -> bool {
        !self.files.module(declared.file).is_lib
            && self.files.decls_of(declared).iter().all(|&(file, decl)| matches!(decl, Decl::Member(_)) && (self.is_declaration_only(file) || self.hir(file).is_ambient(self.hir(file).parent(self.hir(file).node(decl)))))
    }

    fn is_declared_by_ambient_class(&mut self, class: TypeId, name: Atom, depth: u32) -> bool {
        let Some(members) = self.members(class) else { return false };
        let Some(prop) = members.resolved.prop(name) else { return false };
        let declared = match &prop.source {
            &PropSource::Symbol(declared) => declared,
            PropSource::Intersected(_, parts) | PropSource::Mapped(_, _, Some(parts)) | PropSource::Copy(_, parts, _) | PropSource::ReverseMapped(_, parts) => {
                return parts.iter().any(|part| matches!(part.source, PropSource::Symbol(declared) if self.is_ambient_member(declared)));
            }
            _ => return false,
        };
        if self.files.module(declared.file).is_lib {
            return false;
        }
        let member_of_class = |c: &Self, file: FileId, decl: Decl| match decl {
            Decl::Member(member) if matches!(c.bound(file).member_owner[member.idx()], MemberOwner::Class(_)) => Some(c.hir(file)[member].kind),
            _ => None,
        };
        let decls = self.files.decls(declared);
        if decls.iter().all(|&(file, decl)| matches!(decl, Decl::Member(_)) && (self.is_declaration_only(file) || self.hir(file).is_ambient(self.hir(file).parent(self.hir(file).node(decl))))) {
            return true;
        }
        let TypeData::Ref { target, .. } = *self.data(class) else { return false };
        if decls.iter().all(|&(file, decl)| matches!(decl, Decl::Member(_)) && self.hir(file).is_ambient(self.hir(file).node(decl)))
            && self.base_types(target).into_vec().into_iter().any(|base| self.members(base).is_some_and(|members| members.resolved.prop(name).is_some()))
        {
            return true;
        }
        depth < 16
            && decls.iter().all(|&(file, decl)| member_of_class(self, file, decl) == Some(MemberKind::Property))
            && self.base_types(target).into_vec().into_iter().any(|base| self.is_declared_by_ambient_class(base, name, depth + 1))
    }

    pub(super) fn declaring_container_name(&self, member: Sym) -> Option<Atom> {
        if let Some(parent) = self.files.parent_of_symbol(member) {
            return Some(self.files.symbol(parent).name);
        }
        self.files.decls_of(member).iter().copied().find_map(|(file, decl)| match decl {
            Decl::Member(m) => match self.bound(file).member_owner[m.idx()] {
                MemberOwner::Interface(owner) => Some(self.hir(file)[owner].name),
                MemberOwner::Class(owner) => Some(self.hir(file)[owner].name),
                _ => None,
            },
            _ => None,
        })
    }

    fn is_listed(&self, holder: Atom, name: Atom) -> bool {
        if holder.is_none() || name.is_none() {
            return true;
        }
        let atoms = self.atoms();
        let holder = atoms.bytes(holder);
        let holder = holder.strip_suffix(b"Constructor").filter(|rest| !rest.is_empty()).unwrap_or(holder);
        let holder = ALIASES.iter().find(|alias| alias.0.as_bytes() == holder).map_or(holder, |alias| alias.1.as_bytes());
        let name = atoms.bytes(name);
        let symbol;
        let name = match name.strip_prefix(SYMBOL_NAME_PREFIX) {
            Some(rest) => {
                symbol = [&b"@@"[..], rest].concat();
                &symbol[..]
            }
            None => name,
        };
        let is_typed_array = TYPED_ARRAYS.iter().any(|known| known.as_bytes() == holder);
        if names_of(holder).is_none() && !is_typed_array {
            return true;
        }
        let is_protocol = holder == b"Iterator" && matches!(name, b"next" | b"return" | b"throw");
        is_protocol || has_entry(holder, name) || is_typed_array && has_entry(b"TypedArray", name) || has_entry(b"Object", name)
    }
}
