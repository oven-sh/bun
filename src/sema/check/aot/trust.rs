//! Which declarations the compiler trusts.
//!
//! The line is whether the checker has seen the code behind a claim.
//! 1. Ordinary TypeScript (a body, a literal, a `new`) is checked against its annotation: a fact.
//! 2. An escape hatch (`as`, `!`, a type guard, a value out of `any`) is asserted or coerced on the spot.
//! 3. A declaration WITHOUT A BODY is a prediction: a `.d.ts`, `declare function`, `declare const`, `declare class`, `declare global`,
//!    `declare module`, an overload list without an implementation, a file in whose place other code runs
//!    (`Checker::is_declaration_only`). The static type of what it produces is `unknown`, the declared
//!    type is the predicted type. Guarded fast path, generic fallback, never a `TypeError`.
//!
//! The predicate is on the declaration that PRODUCED the value, not on its type: `const o: FromADts = { .. }` is the program's own claim.
//!
//! What the engine implements itself stays trusted: `BUILTINS`.

use crate::atom::{Atom, SYMBOL_NAME_PREFIX, known};
use crate::bind::{Decl, MemberOwner, Parent, PatParent, SymFlags};
use crate::check::Checker;
use super::builtins_generated::BUILTINS;
use super::storage::Query;
use crate::hir::{BinOp, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, MemberKind, VarKind};
use crate::program::{FileId, Sym};
use crate::types::{MapperId, Prop, PropFlags, PropSource, TypeData, TypeId};
use crate::util::{FxHashMap, FxHashSet};

/// Globals of the language that are no functions.
const GLOBAL_VALUES: &[&str] = &["undefined", "NaN", "Infinity", "globalThis"];

/// Interfaces of `lib.*.d.ts` that describe objects of a holder under another name.
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

/// What a declaration without a body claimed.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum Claim {
    /// The value of an ambient variable, function, class, namespace or module.
    Binding,
    /// The result of calling a value that is itself predicted.
    Call,
    /// The same, where the declared result mentions a type parameter, so that its type is what the call puts in for that: inferred
    /// from the arguments of the program, `lib.first(rows)`.
    GenericCall,
    /// The same, where the program writes the type arguments: `lib.parse<Row[]>(text)`.
    GenericCallWithTypeArguments,
    New,
    /// A property or an element of a value that is itself predicted, or a property of an engine object that the table has no entry for.
    Property,
    Await,
}

impl Claim {
    const ALL: [Claim; 7] = [Claim::Binding, Claim::Call, Claim::GenericCall, Claim::GenericCallWithTypeArguments, Claim::New, Claim::Property, Claim::Await];

    /// For `Checker::solve`.
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
    external_assignment_cache: FxHashMap<(TypeId, Atom), bool>,
    literal_spreads: Option<((FileId, ExprId), std::rc::Rc<[crate::hir::PropId]>)>,
}

impl State {
    pub(super) fn enable_expr_cache_for(&mut self, file: FileId, expressions: usize) {
        self.claims.switch_to_file(file, expressions, None);
    }
}

impl<'p, 's> Checker<'p, 's> {
    /// If the checker's type of `e` rests on a declaration without a body that the engine does not implement: what was claimed. The
    /// value is then `unknown` with the checker's type as its prediction.
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
        // Whether a value is predicted may depend on itself. What leans on nothing else is not: a prediction comes from somewhere.
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

    /// Whether `e` yields `unknown` although the checker has a type for it: a prediction, or what has been computed or read from one.
    pub fn is_predicted(&mut self, file: FileId, e: ExprId) -> bool {
        if let ExprKind::NonNull(asserted) = self.hir(file)[e].kind {
            return self.is_predicted(file, asserted);
        }
        let yielded = self.result_type_of(file, e);
        self.is_uninformative(yielded) && {
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
                // The type of the call is that of its first argument, and more.
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
                    // What `lib.*.d.ts` declares is typed by what it is handed: `Object.entries(given)`.
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

    /// `mine.map(f)`, `Mine.from(list)`, where `class Mine extends Array<number>`: `lib.*.d.ts` says that the call yields a `number[]`. The
    /// engine makes what it yields through the constructor of the receiver (`Symbol.species`, `this`): a `Mine`. So of a method that
    /// `lib.*.d.ts` declares, called on an object or on the constructor of a class that extends a class of the engine, what is declared
    /// to be an object is a prediction.
    fn is_allocated_by_subclass_constructor(&mut self, file: FileId, e: ExprId, callee: ExprId) -> bool {
        let ExprKind::Dot { obj, .. } = self.hir(file)[callee].kind else { return false };
        let is_declared_by_lib = self.resolved_signature(file, e).sig.and_then(|sig| self.sig_decl(sig)).is_some_and(|(of, ..)| self.files.module(of).is_lib);
        if !is_declared_by_lib || matches!(self.hir(file)[obj].kind, ExprKind::Super) {
            return false;
        }
        let yielded = self.type_of_expr(file, e);
        if !self.parts(yielded).iter().copied().any(|part| self.is_object_type(part)) {
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

    /// Whether no declaration of the symbol that gives it a value has code behind it: all are in a declaration file or under `declare`, and
    /// no function among them has a body. An enum is its constants, wherever it is declared.
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
            || self.is_host_global(receiver, name);
        if self.is_assumption_free(asked) && is_settled {
            self.aot.trust.of_properties.insert((receiver, name), found);
        }
        found
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
        let yielded = self.result_type_of(file, e);
        if yielded == self.type_of_expr(file, e) {
            return false;
        }
        let promised = self.awaited(yielded);
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

    /// `Math`, `JSON`, `Map`, `parseInt`, `console`, `undefined`: an ambient global that the table knows as a holder, a function or a
    /// constructor, whichever declaration file declares it.
    fn is_builtin_global(&self, sym: Sym) -> bool {
        // A module has no name.
        let name = self.files.symbol(sym).name;
        if name.is_none() || self.files.parent_of_symbol(sym).is_some() {
            return false;
        }
        is_engine_global(self.atoms().bytes(name))
    }

    /// Whether `obj.name` reads a property that `lib.*.d.ts` declares for an object of the engine and the table has no entry for:
    /// `error.message`, `match.index`, `fn.name`. What the program itself declares for such an object, `NodeArray.pos`, is its own claim.
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

    /// Whether the engine itself vouches for the type of `e`: it reads a property or calls a method that `lib.*.d.ts` declares for an object of
    /// the engine, the table has an entry for it, and what is declared for it mentions no type parameter. `a.length`, `map.has(k)`,
    /// `text.startsWith(p)`, `Array.isArray(x)`. Not `map.get(k)` or `a.find(f)`: what a container holds, its history says.
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

    /// Whether the table knows the holder, as `lib.*.d.ts` names it: see `is_listed`.
    fn is_engine_holder(&self, holder: Atom) -> bool {
        let holder = self.atoms().bytes(holder);
        let holder = holder.strip_suffix(b"Constructor").filter(|rest| !rest.is_empty()).unwrap_or(holder);
        let holder = ALIASES.iter().find(|alias| alias.0.as_bytes() == holder).map_or(holder, |alias| alias.1.as_bytes());
        names_of(holder).is_some() || TYPED_ARRAYS.iter().any(|known| known.as_bytes() == holder)
    }

    /// Whether the property is one of an object literal that nothing is written down for, initialized with a prediction: `return {
    /// performance }`. It is like an unannotated variable: its type was inferred from the declaration without a body, so what it holds
    /// stays a prediction, and the field has room for anything.
    pub fn is_prop_predicted(&mut self, prop: &Prop) -> bool {
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

    /// Whether some object of the type has such a property by the name.
    pub(super) fn has_predicted_prop(&mut self, ty: TypeId, name: Atom) -> bool {
        let ty = self.non_nullable(ty);
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

    fn find_external_assignment(&mut self, holder: TypeId, name: Atom) -> bool {
        let Some(members) = self.members(holder) else { return false };
        let Some(prop) = members.resolved.prop(name) else { return false };
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
        }
        let Some(assignments) = self.property_assignments().get(&name) else { return false };
        for &(file, assignment) in assignments {
            let hir = self.hir(file);
            let ExprKind::Assign { op, target, value } = hir[assignment].kind else { continue };
            let ExprKind::Dot { obj, .. } = hir[target].kind else { continue };
            let receiver = self.type_of_expr(file, obj);
            let receiver = self.non_nullable(receiver);
            if self.is_uninformative(receiver) || !self.is_provably_assignable(holder, receiver) {
                continue;
            }
            let stored = if matches!(op, None | Some(BinOp::And | BinOp::Or | BinOp::Nullish)) { value } else { assignment };
            if self.is_derived_from_prediction(file, stored, 0) {
                return true;
            }
        }
        false
    }

    pub fn is_widened_by_checked_source_store(&mut self, holder: TypeId, name: Atom) -> bool {
        if self.is_inferred_property_assigned_external_data(holder, name) {
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

    /// Whether some object of the type has the property from a class without a body: `this.props` and `this.state` where `class App extends
    /// Component<Props, State>` of `@types/react`. The code behind that class stores to it, and nobody has held that code to what is declared.
    pub(super) fn has_ambient_class_member(&mut self, ty: TypeId, name: Atom) -> bool {
        let ty = self.non_nullable(ty);
        let parts: &[TypeId] = self.parts(ty);
        parts.iter().copied().any(|part| {
            // `this` is of a type parameter.
            let apparent = self.apparent_type(part);
            self.is_ambient_module_type(part) || self.is_declared_by_ambient_class(apparent, name, 0)
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
        // Also of an interface or a type literal there: `element.props`, where `interface ReactElement<P> { props: P }`.
        if decls.iter().all(|&(file, decl)| matches!(decl, Decl::Member(_)) && (self.is_declaration_only(file) || self.hir(file).is_ambient(self.hir(file).parent(self.hir(file).node(decl))))) {
            return true;
        }
        // A field that the program declares again, `state = { seen: 0 }`: the code behind the class that it extends stores to it all the same.
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

    /// The name of the interface, class or namespace that declares the member.
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

    /// `holder`: as `lib.*.d.ts` names it. `ArrayConstructor` is the static side of `Array`. A holder that the table does not know at all is no
    /// object of the engine: `Intl.NumberFormat`, `URL`. Its values are predictions to begin with, so what is read from a fact of that
    /// type is the claim of whoever annotated it.
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
        // The iterator protocol has no entries: the engine's iterators and the program's generators implement it.
        let is_protocol = holder == b"Iterator" && matches!(name, b"next" | b"return" | b"throw");
        is_protocol || has_entry(holder, name) || is_typed_array && has_entry(b"TypedArray", name) || has_entry(b"Object", name)
    }
}
