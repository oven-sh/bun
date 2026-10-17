use super::mutations::Mutations;
use super::flows::{EscapeQuery, Place};
use super::int32_fields::CodeOwner;
use super::builtins_generated::{Arity, BUILTIN_ENTRIES, BuiltinEntry, BuiltinKind, Pattern, uses};
use super::trust::{ALIASES, TYPED_ARRAYS};
use super::type_caches::is_published;
use super::type_flags::{IS_UNTYPED_FOR_OBJECTS, MAY_HOLD_OBJECTS, UNTYPED_FOR_OBJECTS_KNOWN};
use crate::atom::Atom;
use crate::bind::{Decl, Parent};
use crate::check::{Checker, ContextFlags};
use crate::hir::{BinOp, CallId, ExprId, ExprKind, ExprTag, FileKind, PropKind, StmtKind, TypeParamId, UnOp};
use crate::program::{FileId, Sym};
use crate::types::{MapperId, Origin, PropSource, SigId, TypeData, TypeId};
use crate::util::{FxHashMap, FxHashSet};
use std::hash::Hash;
use std::rc::Rc;
use std::sync::OnceLock;

pub(super) type TypeParameter = (FileId, TypeParamId);

pub(crate) struct Escapes<T = TypeId> {
    pub(super) mutations: Option<Box<Mutations<T>>>,
}

impl<T> Default for Escapes<T> {
    fn default() -> Escapes<T> {
        Escapes { mutations: None }
    }
}

impl<T: Copy + Eq + Hash> Escapes<T> {
    pub(super) fn with_mutations<R>(&self, read: impl FnOnce(&Mutations<T>) -> R) -> R {
        match &self.mutations {
            Some(recorded) => read(recorded),
            None => read(&Mutations::default()),
        }
    }

    pub(super) fn absorb(&mut self, other: Escapes<T>) {
        if let Some(recorded) = other.mutations {
            self.mutations.get_or_insert_with(Default::default).absorb(*recorded);
        }
    }

    pub(super) fn renamed<U: Copy + Eq + Hash>(self, rename: &mut impl FnMut(T) -> Option<U>) -> Escapes<U> {
        Escapes { mutations: self.mutations.map(|recorded| Box::new(recorded.renamed(rename))) }
    }
}

#[derive(Copy, Clone)]
enum Destination {
    Nowhere,
    WithParent,
    Typed(TypeId),
    Untyped,
}

#[derive(Copy, Clone)]
enum CalleeKind {
    Typed,
    BuiltIn(Atom, Atom),
    Unknown,
}

#[derive(Default)]
pub(super) struct State {
    flows: FxHashSet<(TypeId, TypeId)>,
    receiving_any: FxHashSet<TypeId>,
    nested_parameter_indices: Vec<u32>,
    pub(super) entered: FxHashSet<(TypeId, TypeId)>,
    pub(super) visited_type_inflows: FxHashSet<(TypeId, TypeId)>,
    pub(super) visited_untyped_slots: FxHashSet<(TypeId, Option<TypeId>)>,
    pub(super) queries: FxHashMap<EscapeQuery, Place>,
    bound: FxHashSet<TypeId>,
    bound_at_calls: FxHashSet<SigId>,
    callees: FxHashMap<ExprId, CalleeKind>,
    uses: FxHashMap<CallId, Option<(u16, Rc<[u16]>)>>,
    untyped_callbacks: FxHashMap<CallId, bool>,
    literal_destinations: FxHashMap<ExprId, Destination>,
    built_in_operands: FxHashSet<ExprId>,
    query_scratch: Option<Box<State>>,
    wide_unions_with_instances: FxHashMap<TypeId, bool>,
    visited_file: Option<FileId>,
    literal_contexts: FxHashMap<ExprId, Option<TypeId>>,
}

const MAX_REUSED_TABLE_CAPACITY: usize = 512;

macro_rules! clear_or_shrink {
    ($($table:expr),*) => {$(
        if $table.capacity() > MAX_REUSED_TABLE_CAPACITY {
            $table = Default::default();
        } else {
            $table.clear();
        }
    )*};
}

impl State {
    fn reset(&mut self) {
        clear_or_shrink!(
            self.flows,
            self.receiving_any,
            self.nested_parameter_indices,
            self.entered,
            self.visited_type_inflows,
            self.visited_untyped_slots,
            self.queries,
            self.bound,
            self.bound_at_calls,
            self.callees,
            self.uses,
            self.untyped_callbacks,
            self.literal_destinations,
            self.built_in_operands,
            self.literal_contexts
        );
    }
}

fn entries_of(holder: &str, name: &[u8]) -> &'static [BuiltinEntry] {
    static INDEX: OnceLock<FxHashMap<(&'static str, &'static [u8]), (usize, usize)>> = OnceLock::new();
    let index = INDEX.get_or_init(|| {
        let mut index: FxHashMap<(&'static str, &'static [u8]), (usize, usize)> = FxHashMap::default();
        for (at, entry) in BUILTIN_ENTRIES.iter().enumerate() {
            index.entry((entry.holder, entry.name.as_bytes())).or_insert((at, at)).1 = at + 1;
        }
        index
    });
    index.get(&(holder, name)).map_or(&[], |&(from, to)| &BUILTIN_ENTRIES[from..to])
}

fn canonical_holder_name(text: &[u8]) -> Option<&'static str> {
    static HOLDERS: OnceLock<FxHashMap<&'static [u8], &'static str>> = OnceLock::new();
    HOLDERS.get_or_init(|| BUILTIN_ENTRIES.iter().map(|entry| (entry.holder.as_bytes(), entry.holder)).collect()).get(text).copied()
}

const MAX_NESTED_FLOWS: u32 = 3;

const MAX_PART_PAIRS: usize = 64;

const MAX_PRIMITIVE_PARTS: usize = 16;

const MAX_PARTS_SCANNED_PER_USE: usize = 8;

impl<'p, 's> Checker<'p, 's> {
    fn record_flow(&mut self, source: TypeId, target: TypeId) {
        self.record_flow_at_depth(source, target, 0);
    }

    fn record_flow_at_depth(&mut self, source: TypeId, target: TypeId, depth: u32) {
        self.record_nested_flow(source, target, depth, false);
    }

    fn record_nested_flow(&mut self, source: TypeId, target: TypeId, depth: u32, is_parameter_without_second_body: bool) {
        if self.holds_only_primitives(target) || self.holds_only_primitives(source) {
            return;
        }
        if is_parameter_without_second_body && !target.is_never() && self.is_any_like(source) && self.aot.escape_closure.receiving_any.insert(target) {
            self.record_any_inflow_to_records(target);
        }
        if source == target || source.is_never() || target.is_never() || !self.aot.escape_closure.flows.insert((source, target)) {
            return;
        }
        self.record_type_parameter_inflow(source, target);
        if self.is_untyped_for_objects(target) || self.is_untyped_for_objects(source) || depth > MAX_NESTED_FLOWS {
            return;
        }
        let carried = self.nested_flows(source, target);
        let parameter_count = carried.last().map_or(0, |&(_, number)| number.0 as usize);
        let flow_count = carried.len() - 1 - parameter_count;
        for (index, &(held, slot_type)) in carried[..flow_count].iter().enumerate() {
            let is_parameter = carried[flow_count..carried.len() - 1].iter().any(|&(_, parameter)| parameter.0 as usize == index);
            self.record_nested_flow(held, slot_type, depth + 1, is_parameter);
        }
    }

    fn nested_flows(&mut self, source: TypeId, target: TypeId) -> Rc<[(TypeId, TypeId)]> {
        let is_result_cacheable = !self.results_are_provisional() && !self.is_type_of_one_expression(source) && !self.is_type_of_one_expression(target);
        if is_result_cacheable && let Some(known) = self.aot.flows.carried.get(&(source, target)) {
            return Rc::clone(known);
        }
        let caches = self.type_caches().filter(|_| is_result_cacheable && is_published(source) && is_published(target));
        if let Some(known) = caches.and_then(|caches| caches.nested_flows.get_as((source, target), |known| Rc::<[(TypeId, TypeId)]>::from(&known[..]))) {
            self.aot.flows.carried.insert((source, target), Rc::clone(&known));
            return known;
        }
        let careful_before = (self.stack_half_used_count(), self.aot.flows.unknown_count);
        let mut carried = Vec::new();
        let of_outer_flow = std::mem::take(&mut self.aot.escape_closure.nested_parameter_indices);
        let ((), is_cacheable) = self.compute_cacheable(|c| c.add_nested_flows(source, target, &mut carried));
        let parameters = std::mem::replace(&mut self.aot.escape_closure.nested_parameter_indices, of_outer_flow);
        let parameter_count = parameters.len() as u32;
        carried.extend(parameters.into_iter().map(|index| (TypeId::NEVER, TypeId(index))));
        carried.push((TypeId::NEVER, TypeId(parameter_count)));
        let carried: Rc<[(TypeId, TypeId)]> = carried.into();
        if is_result_cacheable && careful_before == (self.stack_half_used_count(), self.aot.flows.unknown_count) {
            self.aot.flows.carried.insert((source, target), Rc::clone(&carried));
            let is_task_independent = is_cacheable && carried.iter().all(|&(from, to)| is_published(from) && is_published(to));
            if let Some(caches) = caches.filter(|_| is_task_independent && !self.has_order_dependent_results()) {
                caches.nested_flows.insert((source, target), carried.iter().copied().collect());
            }
        }
        carried
    }

    pub(super) fn is_untyped_for_objects(&mut self, ty: TypeId) -> bool {
        if self.is_uninformative(ty) {
            return true;
        }
        if let Some(row) = self.translation_type_flags(ty, UNTYPED_FOR_OBJECTS_KNOWN) {
            return row & IS_UNTYPED_FOR_OBJECTS != 0;
        }
        let is_result_cacheable = !self.results_are_provisional();
        if is_result_cacheable && let Some(&known) = self.aot.flows.untyped_for_objects.get(&ty) {
            return known;
        }
        let careful_before = (self.stack_half_used_count(), self.aot.flows.unknown_count);
        let (found, is_cacheable) = self.compute_cacheable(|c| {
            c.parts(ty).iter().any(|&part| c.is_uninformative(part) && !part.is_never() || part == TypeId::OBJECT || !c.is_instantiable(part) && c.accepts_primitives(part) || c.is_nested_too_deeply(part) || c.is_global_function_type(part))
        });
        if is_result_cacheable && careful_before == (self.stack_half_used_count(), self.aot.flows.unknown_count) {
            if is_cacheable && self.type_caches().is_some() && !self.has_order_dependent_results() {
                self.cache_type_flag(ty, UNTYPED_FOR_OBJECTS_KNOWN, IS_UNTYPED_FOR_OBJECTS, found);
            } else {
                self.aot.flows.untyped_for_objects.insert(ty, found);
            }
        }
        found
    }

    fn is_global_function_type(&mut self, ty: TypeId) -> bool {
        let known = match self.aot.flows.function_types {
            Some(known) => known,
            None => {
                let found = [crate::atom::known::Function, crate::atom::known::CallableFunction, crate::atom::known::NewableFunction].map(|name| self.global_ref(name, &[]));
                *self.aot.flows.function_types.insert(found)
            }
        };
        known.contains(&ty)
    }

    fn add_nested_flows(&mut self, source: TypeId, target: TypeId, carried: &mut Vec<(TypeId, TypeId)>) {
        let to_parts: Vec<TypeId> = self.parts(target).iter().copied().filter(|&part| !self.has_primitive_flag(part)).collect();
        let in_target: FxHashSet<TypeId> = to_parts.iter().copied().collect();
        let from_parts: Vec<TypeId> = self.parts(source).iter().copied().filter(|part| !self.has_primitive_flag(*part) && !in_target.contains(part)).collect();
        if from_parts.len() * to_parts.len() <= MAX_PART_PAIRS {
            for &from in &from_parts {
                for &to in &to_parts {
                    self.add_nested_flows_between(from, to, carried);
                }
            }
            return;
        }
        let mut by_declaration: FxHashMap<Sym, Vec<TypeId>> = FxHashMap::default();
        for &to in &to_parts {
            if let TypeData::Ref { target: declared, .. } = *self.data(to) {
                by_declaration.entry(declared).or_default().push(to);
            }
        }
        for from in from_parts {
            let matching = match *self.data(from) {
                TypeData::Ref { target: declared, .. } => by_declaration.get(&declared).cloned().unwrap_or_default(),
                _ => Vec::new(),
            };
            for to in matching {
                self.add_nested_flows_between(from, to, carried);
            }
        }
    }

    fn add_nested_flows_between(&mut self, from: TypeId, to: TypeId, carried: &mut Vec<(TypeId, TypeId)>) {
        if let (TypeData::Ref { target: declared, .. }, TypeData::Ref { target: as_declared, .. }) = (self.data(from), self.data(to))
            && declared == as_declared
        {
            let pairs: Vec<(TypeId, TypeId)> = self.type_arguments(from).iter().copied().zip(self.type_arguments(to).iter().copied()).collect();
            for (held, slot_type) in pairs {
                carried.extend([(held, slot_type), (slot_type, held)]);
            }
            return;
        }
        for key in [TypeId::NUMBER, TypeId::STRING] {
            if let (Some(held), Some(slot_type)) = (self.index_type_of_type(from, key), self.index_type_of_type(to, key)) {
                carried.extend([(held, slot_type), (slot_type, held)]);
            }
        }
        self.add_function_member_flows(from, to, carried);
        for constructs in [false, true] {
            let called_types: Vec<SigId> = self.signatures(to, constructs).iter().copied().collect();
            let declared_types_all: Vec<SigId> = self.signatures(from, constructs).iter().copied().collect();
            for &called_as in &called_types {
                let arguments = self.sig_params(called_as);
                for &declared_sig in &declared_types_all {
                    let parameters = self.sig_params(declared_sig);
                    let is_served = self.is_served_by_untyped_clone(declared_sig);
                    for index in 0..parameters.len() {
                        if let (Some(argument), Some(parameter)) = (self.param_type_at(&arguments, index), self.param_type_at(&parameters, index)) {
                            if !is_served {
                                self.aot.escape_closure.nested_parameter_indices.push(carried.len() as u32);
                            }
                            carried.push((argument, parameter));
                        }
                    }
                    let (produced, produced_as) = (self.sig_return(declared_sig), self.sig_return(called_as));
                    carried.push((produced, produced_as));
                }
            }
        }
    }

    fn add_function_member_flows(&mut self, from: TypeId, to: TypeId, carried: &mut Vec<(TypeId, TypeId)>) {
        if !self.declares_properties(from) || !self.declares_properties(to) {
            return;
        }
        if self.is_declared_by_package(from) || self.is_declared_by_package(to) {
            return;
        }
        let (Some(of_from), Some(of_to)) = (self.members(from), self.members(to)) else { return };
        for as_prop in of_to.shape().props.iter() {
            let Some(prop) = of_from.resolved.prop(as_prop.name) else { continue };
            if let (&PropSource::Symbol(declared), &PropSource::Symbol(as_declared)) = (&prop.source, &as_prop.source)
                && declared == as_declared
                && of_from.mapper == of_to.mapper
            {
                continue;
            }
            let (held, slot_type) = (self.type_of_prop(prop, of_from.mapper), self.type_of_prop(as_prop, of_to.mapper));
            let may_be_function = |this: &mut Self, ty: TypeId| this.parts(ty).to_vec().into_iter().any(|part| !this.signatures(part, false).is_empty() || !this.signatures(part, true).is_empty());
            if held != slot_type && may_be_function(self, held) && may_be_function(self, slot_type) {
                carried.extend([(held, slot_type), (slot_type, held)]);
            }
        }
    }

    fn is_declared_by_package(&self, ty: TypeId) -> bool {
        let declared_in = match *self.data(ty) {
            TypeData::Ref { target, .. } => target.file,
            TypeData::Anon { origin: Origin::TypeLiteral(file, _) | Origin::Mapped(file, _), .. } => file,
            _ => return false,
        };
        self.hir(declared_in).kind == FileKind::Declaration && !self.files.module(declared_in).is_lib
    }

    fn record_type_arguments_in(&mut self, ty: TypeId) {
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        for part in parts {
            let TypeData::Ref { target, .. } = *self.data(part) else { continue };
            if !self.aot.escape_closure.bound.insert(part) {
                continue;
            }

            let arguments: Vec<TypeId> = self.type_arguments(part).to_vec();
            for (parameter, argument) in self.type_params_of_symbol(target).iter().copied().zip(arguments) {
                self.record_type_parameter_inflow(argument, parameter);
            }
        }
    }

    pub fn record_escapes_in(&mut self, file: FileId) {
        let hir = self.hir(file);
        if hir.kind == FileKind::Declaration {
            return;
        }
        if self.files.module(file).is_opaque() {
            return;
        }
        self.aot.escape_closure.reset();
        if self.is_untyped_file(file) {
            self.record_javascript_mutations(file);
            self.record_js_calls_to_typed_imports(file);
            let calls: Vec<ExprId> = self.file_exprs_by_kind(file).of(ExprTag::Call).to_vec();
            for e in calls {
                self.record_construction_with_other_new_target(file, e);
            }
        }
    }

    fn evaluating_code(&self, file: FileId, mut parent: Parent) -> CodeOwner {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            parent = match parent {
                Parent::Expr(e) if e.is_some() => bound.expr_parent[e.idx()],
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                Parent::FnBody(func) => return CodeOwner::Function(func),
                Parent::ParamDefault(p) => return CodeOwner::Function(bound.param_fn[p.idx()]),
                Parent::MemberKey(member) => match bound.member_owner[member.idx()] {
                    crate::bind::MemberOwner::Class(class) => bound.class_owner[class.idx()].to_parent(),
                    _ => return CodeOwner::Module,
                },
                Parent::Decorator(class, _) => bound.class_owner[class.idx()].to_parent(),
                Parent::MethodKey(prop) => Parent::Expr(bound.prop_owner[prop.idx()]),
                Parent::MemberInit(member) if !hir[member].flags.contains(crate::hir::Flags::STATIC) => match bound.member_owner[member.idx()] {
                    crate::bind::MemberOwner::Class(class) => return CodeOwner::ClassConstructor(class),
                    _ => return CodeOwner::Module,
                },
                Parent::File | Parent::None => return CodeOwner::Module,
                _ => self.parent_of_node(file, parent),
            };
        }
    }

    pub fn are_escapes_recorded_for(&self, file: FileId) -> bool {
        self.hir(file).kind != FileKind::Declaration && !self.files.module(file).is_opaque() && !self.is_untyped_file(file)
    }

    pub fn code_with_recorded_escapes(&mut self, file: FileId) -> Vec<(CodeOwner, Vec<ExprId>)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !self.are_escapes_recorded_for(file) {
            return Vec::new();
        }
        let (functions, classes) = (hir.fns.len() as u32, hir.classes.len() as u32);
        let rank = |by: CodeOwner| match by {
            CodeOwner::Module => 0,
            CodeOwner::Function(func) => 1 + func.0.min(functions),
            CodeOwner::ClassConstructor(class) => 2 + functions + class.0.min(classes),
        };
        const NOT_FOUND: u32 = u32::MAX;
        let mut ranks: Vec<u32> = vec![NOT_FOUND; hir.exprs.len()];
        let mut sizes: Vec<u32> = vec![0; 3 + hir.fns.len() + hir.classes.len()];
        let mut on_the_way: Vec<ExprId> = Vec::new();
        for e in (0..hir.exprs.len() as u32).map(ExprId) {
            let mut at = e;
            let found = loop {
                if ranks[at.idx()] != NOT_FOUND {
                    break ranks[at.idx()];
                }
                on_the_way.push(at);
                match bound.expr_parent[at.idx()] {
                    Parent::Expr(around) if around.is_some() => at = around,
                    parent => break rank(self.evaluating_code(file, parent)),
                }
            };
            sizes[found as usize] += on_the_way.len() as u32;
            for passed in on_the_way.drain(..) {
                ranks[passed.idx()] = found;
            }
        }
        let mut groups: Vec<Vec<ExprId>> = sizes.iter().map(|&size| Vec::with_capacity(size as usize)).collect();
        for (e, &rank) in ranks.iter().enumerate() {
            groups[rank as usize].push(ExprId(e as u32));
        }
        let run_by = |rank: u32| match rank {
            0 => CodeOwner::Module,
            rank if rank <= functions => CodeOwner::Function(crate::hir::FnId(rank - 1)),
            rank if rank == 1 + functions => CodeOwner::Function(crate::hir::FnId::NONE),
            rank if rank < 2 + functions + classes => CodeOwner::ClassConstructor(crate::hir::ClassId(rank - 2 - functions)),
            _ => CodeOwner::ClassConstructor(crate::hir::ClassId::NONE),
        };
        groups.into_iter().enumerate().filter(|group| !group.1.is_empty()).map(|(rank, group)| (run_by(rank as u32), group)).collect()
    }

    pub fn record_escapes_of(&mut self, file: FileId, expressions: &[ExprId]) {
        self.aot.escape_closure.reset();
        self.aot.escape_closure.visited_file = Some(file);
        for &e in expressions {
            self.record_escape_of(file, e);
        }
        self.aot.escape_closure.visited_file = None;
    }

    pub(in crate::check) fn apparent_type_of_literal_context(&mut self, file: FileId, literal: ExprId, context_flags: ContextFlags) -> Option<TypeId> {
        if self.aot.escape_closure.visited_file != Some(file) || !context_flags.is_empty() || !self.is_top_level_query() || !self.inference_contexts.is_empty() {
            return self.apparent_type_of_contextual_type(file, literal, context_flags);
        }
        if let Some(&known) = self.aot.escape_closure.literal_contexts.get(&literal) {
            return known;
        }
        let (found, is_cacheable) = self.compute_cacheable(|c| c.apparent_type_of_contextual_type(file, literal, context_flags));
        if is_cacheable {
            self.aot.escape_closure.literal_contexts.insert(literal, found);
        }
        found
    }

    fn record_escape_of(&mut self, file: FileId, e: ExprId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let parent = bound.expr_parent[e.idx()];
        if parent == Parent::None || bound.is_in_type_query(e) {
            return;
        }
        let kind = hir[e].kind;
        match kind {
            ExprKind::Assign { target: stored_to, .. } | ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, operand: stored_to } => {
                if let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } = hir[stored_to].kind {
                    self.record_dictionaries_stored_through(file, obj);
                }
                self.record_mutation_by(file, e);
            }
            ExprKind::Unary { .. } => self.record_mutation_by(file, e),
            ExprKind::Call(_) => {
                self.record_mutation_by(file, e);
                self.record_construction_with_other_new_target(file, e);
            }
            ExprKind::Dot { .. } => self.record_method_as_value(file, e, parent),
            ExprKind::Binary { op: BinOp::Instanceof, .. } => self.record_instanceof_operands(file, e),
            _ => {}
        }
        if self.leaks_prototype(file, e, parent) {
            let shown = self.apparent_type_of(file, e, 0);
            self.record_escaping_types(shown, None);
        }
        let entered = if matches!(kind, ExprKind::Object(_)) { self.literal_destination(file, e, parent) } else { self.destination_of(file, e, parent) };
        if let ExprKind::Spread(operand) = kind
            && let Parent::Expr(around) = parent
            && let ExprKind::Call(call) | ExprKind::New(call) = hir[around].kind
        {
            let spread = self.type_of_expr(file, operand);
            if self.is_untyped(spread)
                && let Some(signature) = self.resolved_signature(file, around).sig
            {
                let index = hir.ids(hir[call].args).position(|argument| argument == e).unwrap_or(0);
                let parameters: Vec<TypeId> = self.sig_params(signature).iter().map(|parameter| parameter.ty).collect();
                self.set_current_site(file, hir[e].pos);
                for &parameter in parameters.iter().skip(index.min(parameters.len().saturating_sub(1))) {
                    self.record_untyped_inflow_to_classes(parameter);
                }
            }
        }
        if matches!(entered, Destination::Nowhere) {
            return;
        }
        let own = self.type_of_expr(file, e);
        self.set_current_site(file, hir[e].pos);
        if let Destination::Typed(target) = entered
            && self.is_untyped(own)
        {
            let mut source = e;
            while let ExprKind::As { expr: inner, .. } | ExprKind::NonNull(inner) | ExprKind::Satisfies { expr: inner, .. } = hir[source].kind {
                source = inner;
            }
            let written = self.type_of_expr(file, source);
            if self.is_untyped(written) {
                self.note_escape_query_once(EscapeQuery::UntypedIntoPlace(target));
            }
        }
        let is_primitive = self.holds_only_primitives(own);
        if !is_primitive {
            if matches!(kind, ExprKind::Fn(_) | ExprKind::Ident(_) | ExprKind::Dot { .. })
                && matches!(parent, Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Call(_) | ExprKind::New(_)))
            {
                if self.may_have_type_predicate(own) {
                    self.note_escape_query_once(EscapeQuery::ThroughGuardsOf(own));
                }
            }
            match entered {
                Destination::Nowhere => {}
                Destination::Typed(target) => self.record_built_in_as_value(file, e, Some(target)),
                Destination::Untyped => self.record_built_in_as_value(file, e, None),
                Destination::WithParent => {
                    let around = if let Parent::Expr(around) = parent { around } else { e };
                    let target = self.type_of_expr(file, around);
                    self.record_built_in_as_value(file, e, Some(target));
                }
            }
            if match entered {
                Destination::Untyped => !self.aot.escape_closure.built_in_operands.contains(&e) && !self.is_passed_to_read_only_built_in(file, e, parent),
                Destination::Typed(target) => self.is_untyped_for_objects(target),
                Destination::Nowhere | Destination::WithParent => false,
            } {
                self.record_dictionaries_stored_through(file, e);
            }
        }
        if let Parent::Prop(prop) = parent {
            let mut literal = bound.prop_owner[prop.idx()];
            for _ in 0..8 {
                let of_literal = self.type_of_expr(file, literal);
                if self.is_uninformative(of_literal) {
                    self.record_flow_into_untyped_slot(own, None);
                    break;
                }
                let around = bound.expr_parent[literal.idx()];
                match self.literal_destination(file, literal, around) {
                    Destination::Untyped => self.record_flow_into_untyped_slot(own, None),
                    Destination::Typed(target) => self.record_flow_into_untyped_slot(own, Some(target)),
                    Destination::Nowhere | Destination::WithParent => {}
                }
                let Parent::Prop(above) = around else { break };
                literal = bound.prop_owner[above.idx()];
            }
        }
        if matches!(entered, Destination::WithParent) {
            return;
        }
        if is_primitive {
            if let Destination::Typed(target) = entered {
                if self.has_instance_or_type_parameter_part(target) && self.is_predicted(file, e) {
                    self.record_type_accepts_untyped(target, true);
                }
                self.note_escape_query_once(EscapeQuery::Entry(TypeId::STRING, Some(target)));
            }
            return;
        }
        self.record_flow_into_untyped_slot(own, if let Destination::Typed(target) = entered { Some(target) } else { None });
        let is_inherited = matches!(parent, Parent::Expr(around) if matches!(self.hir(file)[around].kind, ExprKind::Call(_) | ExprKind::New(_) | ExprKind::TaggedTemplate(_) | ExprKind::Dot { .. } | ExprKind::Index { .. }));
        if is_inherited && matches!(entered, Destination::Untyped) && !self.is_this_in_own_class_method(file, e, parent) {
            let shown = self.apparent_type_of(file, e, 0);
            let is_tested_on_entry = matches!(self.hir(file)[e].kind, ExprKind::Fn(func) if self.has_untyped_clone(file, func));
            self.note_escape_query_once(EscapeQuery::EscapingValues(shown, is_tested_on_entry));
        }
        if let Destination::Typed(target) = entered
            && self.is_uninformative(own)
            && self.data_origin(file, e).is_some()
        {
            self.record_escaping_types(target, None);
            self.record_type_accepts_untyped(target, false);
        }
        if let Destination::Typed(target) = entered
            && !self.is_uninformative(own)
            && self.has_instance_or_type_parameter_part(target)
            && self.is_predicted(file, e)
        {
            self.record_type_accepts_untyped(target, true);
        }
        self.note_escape_query_once(match entered {
            Destination::Typed(target) if target == own => EscapeQuery::Entry(TypeId::STRING, Some(target)),
            Destination::Typed(target) => EscapeQuery::Entry(own, Some(target)),
            _ => EscapeQuery::Entry(own, None),
        });
    }

    pub(super) fn holds_only_primitives(&self, ty: TypeId) -> bool {
        if self.row(ty) & MAY_HOLD_OBJECTS != 0 || self.is_uninformative(ty) {
            return false;
        }
        let parts = self.parts(ty);
        parts.len() <= MAX_PRIMITIVE_PARTS && parts.iter().all(|&part| self.has_primitive_flag(part))
    }

    fn has_instance_or_type_parameter_part(&mut self, ty: TypeId) -> bool {
        let parts = self.parts(ty);
        if parts.len() > MAX_PARTS_SCANNED_PER_USE
            && let Some(&known) = self.aot.escape_closure.wide_unions_with_instances.get(&ty)
        {
            return known;
        }
        let found = parts.iter().any(|&part| self.is_instance_type(part) || matches!(*self.data(part), TypeData::TypeParam(..)));
        if parts.len() > MAX_PARTS_SCANNED_PER_USE {
            self.aot.escape_closure.wide_unions_with_instances.insert(ty, found);
        }
        found
    }

    pub(super) fn walk_entry(&mut self, own: TypeId, target: Option<TypeId>) {
        let mut scratch = self.aot.escape_closure.query_scratch.take().unwrap_or_default();
        scratch.reset();
        std::mem::swap(&mut self.aot.escape_closure, &mut *scratch);
        self.record_type_arguments_in(own);
        if let Some(target) = target {
            self.record_type_arguments_in(target);
            self.record_flow(own, target);
            self.record_instances_flowing_into_types(own, target);
        }
        std::mem::swap(&mut self.aot.escape_closure, &mut *scratch);
        self.aot.escape_closure.query_scratch = Some(scratch);
    }

    pub(super) fn walk_escaping_values(&mut self, shown: TypeId, is_tested_on_entry: bool) {
        self.record_escaping_types(shown, None);
        self.record_function_parameter_types(shown, is_tested_on_entry);
    }

    fn record_instanceof_operands(&mut self, file: FileId, e: ExprId) {
        let ExprKind::Binary { op: BinOp::Instanceof, left, right } = self.hir(file)[e].kind else { return };
        let asked = self.type_of_expr(file, left);
        let asked = self.non_nullable(asked);
        if self.parts(asked).iter().all(|&part| self.is_instance_type(part)) {
            return;
        }
        let class = self.type_of_expr(file, right);
        let signatures: Vec<SigId> = self.signatures(class, true).iter().copied().collect();
        for signature in signatures {
            let created = self.sig_return(signature);
            self.record_type_accepts_untyped(created, true);
        }
    }

    fn record_construction_with_other_new_target(&mut self, file: FileId, e: ExprId) {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else { return };
        let ExprKind::Dot { obj, name, .. } = hir[hir[call].callee].kind else { return };
        if self.atoms().bytes(name) != b"construct" || !self.refers_to_global_object(file, obj, b"Reflect") {
            return;
        }
        let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
        if arguments.is_empty() || arguments.len() < 3 && !arguments.iter().any(|&argument| matches!(hir[argument].kind, ExprKind::Spread(_))) {
            return;
        }
        let class = self.type_of_expr(file, arguments[0]);
        let mut pending: Vec<TypeId> = self.signatures(class, true).iter().copied().map(|signature| self.sig_return(signature)).collect();
        let mut seen: FxHashSet<TypeId> = FxHashSet::default();
        while let Some(created) = pending.pop() {
            if !seen.insert(created) {
                continue;
            }
            self.record_type_accepts_untyped(created, false);
            if let TypeData::Ref { target, .. } = *self.data(created) {
                pending.extend(self.base_types(target).iter().copied());
            }
        }
    }

    fn record_function_parameter_types(&mut self, shown: TypeId, is_tested_on_entry: bool) {
        let mut taken: Vec<TypeId> = Vec::new();
        for &part in self.parts(shown) {
            let signatures: Vec<SigId> = self.signatures(part, false).iter().copied().collect();
            for signature in signatures {
                taken.extend(self.sig_params(signature).iter().map(|parameter| parameter.ty).filter(|&ty| !self.holds_only_primitives(ty)));
            }
        }
        if let [only] = taken[..] {
            return self.record_escape_query(EscapeQuery::NestedInflows(only, is_tested_on_entry));
        }
        let mut seen: FxHashSet<TypeId> = FxHashSet::default();
        for ty in taken {
            self.record_nested_inflows(ty, 0, is_tested_on_entry, &mut seen);
        }
    }

    pub(super) fn walk_nested_inflows(&mut self, ty: TypeId, is_tested: bool) {
        self.record_nested_inflows(ty, 0, is_tested, &mut FxHashSet::default());
    }

    fn record_nested_inflows(&mut self, ty: TypeId, depth: u32, is_tested: bool, seen: &mut FxHashSet<TypeId>) {
        if depth > 3 || self.holds_only_primitives(ty) || (!is_tested && !seen.insert(ty)) {
            return;
        }
        if !is_tested {
            self.record_type_accepts_untyped(ty, true);
        }
        for &part in self.parts(ty) {
            if self.is_instance_type(part) {
                continue;
            }
            if let TypeData::Ref { .. } = *self.data(part) {
                for &argument in self.type_arguments(part) {
                    self.record_nested_inflows(argument, depth + 1, false, seen);
                }
            } else if self.is_object_type(part) && self.signatures(part, false).is_empty() {
                let Some(members) = self.members(part) else { continue };
                for prop in members.shape().props.iter() {
                    let held = self.type_of_prop(prop, members.mapper);
                    self.record_nested_inflows(held, depth + 1, false, seen);
                }
            }
        }
    }

    fn leaks_prototype(&mut self, file: FileId, e: ExprId, parent: Parent) -> bool {
        let hir = self.hir(file);
        let Parent::Expr(around) = parent else { return false };
        let (ExprKind::Call(call) | ExprKind::New(call)) = hir[around].kind else { return false };
        let callee = hir[call].callee;
        if callee == e {
            return false;
        }
        match hir[callee].kind {
            ExprKind::Dot { obj, name, .. } => match self.atoms().bytes(name) {
                b"create" => self.refers_to_global_object(file, obj, b"Object"),
                b"construct" => self.refers_to_global_object(file, obj, b"Reflect"),
                b"getPrototypeOf" | b"setPrototypeOf" => self.refers_to_global_object(file, obj, b"Object") || self.refers_to_global_object(file, obj, b"Reflect"),
                _ => false,
            },
            ExprKind::Ident(_) => matches!(hir[around].kind, ExprKind::New(_)) && self.refers_to_global_object(file, callee, b"Proxy"),
            _ => false,
        }
    }

    fn apparent_type_of(&mut self, file: FileId, e: ExprId, depth: u32) -> TypeId {
        let own = self.type_of_expr(file, e);
        if !self.is_uninformative(own) || depth > 8 {
            return own;
        }
        match self.hir(file)[e].kind {
            ExprKind::As { expr, .. } | ExprKind::NonNull(expr) | ExprKind::Satisfies { expr, .. } => self.apparent_type_of(file, expr, depth + 1),
            ExprKind::Ident(name) => {
                let Some(sym) = self.symbol_of_identifier(file, e, name) else { return own };
                let Some((of, Decl::Var(pat))) = self.files().value_declaration(sym) else { return own };
                let (hir, bound) = (self.hir(of), self.bound(of));
                let crate::bind::PatParent::Var(d) = bound.pat_parent[pat.idx()] else { return own };
                if hir[d].pat != pat || hir[d].init.is_none() || !bound.assignments_to(bound.pat_symbol[pat.idx()]).is_empty() {
                    return own;
                }
                self.apparent_type_of(of, hir[d].init, depth + 1)
            }
            _ => own,
        }
    }

    fn record_method_as_value(&mut self, file: FileId, e: ExprId, parent: Parent) {
        let hir = self.hir(file);
        let ExprKind::Dot { obj, name, .. } = hir[e].kind else { return };
        if matches!(hir[obj].kind, ExprKind::Super) {
            return;
        }
        let bound = self.bound(file);
        let (mut at, mut parent) = (e, parent);
        while let Parent::Expr(around) = parent
            && matches!(hir[around].kind, ExprKind::NonNull(_) | ExprKind::As { .. } | ExprKind::Satisfies { .. })
        {
            (at, parent) = (around, bound.expr_parent[around.idx()]);
        }
        let mut bound_to = None;
        let is_kept = match parent {
            Parent::Expr(around) => match hir[around].kind {
                ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => hir[call].callee == at,
                ExprKind::Assign { op: None | Some(BinOp::And), target, .. } => target == at,
                ExprKind::Unary { .. } => true,
                ExprKind::Cond { test, .. } => test == at,
                ExprKind::Binary { op: BinOp::And, left, .. } => left == at,
                ExprKind::Binary { op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq, .. } => true,
                ExprKind::Binary { op: BinOp::Instanceof, right, .. } => right == at,
                ExprKind::Dot { obj: function, name: asked, .. } if function == at => match self.atoms().bytes(asked) {
                    b"name" | b"length" => true,
                    b"bind" | b"call" | b"apply" => {
                        if let Parent::Expr(user) = bound.expr_parent[around.idx()]
                            && let ExprKind::Call(call) = hir[user].kind
                            && hir[call].callee == around
                        {
                            bound_to = hir.ids(hir[call].args).next();
                        }
                        false
                    }
                    _ => false,
                },
                _ => false,
            },
            Parent::Stmt(stmt) if stmt.is_some() => match hir[stmt].kind {
                StmtKind::Expr(_) => true,
                StmtKind::If { test, .. } | StmtKind::While { test, .. } | StmtKind::DoWhile { test, .. } | StmtKind::For { test, .. } => test == at,
                _ => false,
            },
            _ => false,
        };
        if is_kept {
            return;
        }
        let given = bound_to.map(|to| self.passed_this_type(file, to));
        let receiver = self.type_of_expr(file, obj);
        let receiver = self.non_nullable(receiver);
        for &part in self.parts(receiver) {
            if !self.is_instance_type(part) || !self.members(part).is_some_and(|members| members.resolved.prop(name).is_some_and(|prop| prop.flags.contains(crate::types::PropFlags::METHOD))) {
                continue;
            }
            let is_bound_to_same_kind = given.is_some_and(|given| self.is_object_of_class(given, part));
            if !is_bound_to_same_kind {
                self.record_escaping_types(part, None);
            }
        }
    }

    fn passed_this_type(&mut self, file: FileId, mut to: ExprId) -> TypeId {
        let hir = self.hir(file);
        while let ExprKind::NonNull(inner) | ExprKind::As { expr: inner, .. } | ExprKind::Satisfies { expr: inner, .. } = hir[to].kind {
            to = inner;
        }
        if matches!(hir[to].kind, ExprKind::Spread(_)) {
            return TypeId::UNKNOWN;
        }
        let given = self.type_of_expr(file, to);
        if self.is_instantiable(given) { self.base_constraint(given) } else { given }
    }

    fn is_object_of_class(&mut self, given: TypeId, class: TypeId) -> bool {
        self.parts(given).to_vec().into_iter().all(|of| self.is_instance_type(of)) && self.is_assignable(given, class)
    }

    fn is_this_in_own_class_method(&mut self, file: FileId, e: ExprId, parent: Parent) -> bool {
        let hir = self.hir(file);
        let Parent::Expr(user) = parent else { return false };
        let ExprKind::Call(call) = hir[user].kind else { return false };
        let ExprKind::Dot { obj: mut function, name: asked, .. } = hir[hir[call].callee].kind else { return false };
        if !matches!(self.atoms().bytes(asked), b"bind" | b"call" | b"apply") || hir.ids(hir[call].args).next() != Some(e) {
            return false;
        }
        while let ExprKind::NonNull(inner) | ExprKind::As { expr: inner, .. } | ExprKind::Satisfies { expr: inner, .. } = hir[function].kind {
            function = inner;
        }
        let ExprKind::Dot { obj, name, .. } = hir[function].kind else { return false };
        let given = self.passed_this_type(file, e);
        let receiver = self.type_of_expr(file, obj);
        let receiver = self.non_nullable(receiver);
        let parts = self.parts(receiver).to_vec();
        !parts.is_empty()
            && parts.into_iter().all(|part| {
                self.is_instance_type(part)
                    && self.members(part).is_some_and(|members| members.resolved.prop(name).is_some_and(|prop| prop.flags.contains(crate::types::PropFlags::METHOD)))
                    && self.is_object_of_class(given, part)
            })
    }

    fn declared_contextual_type(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        self.prepare_enclosing(file, e);
        self.contextual_type(file, e, ContextFlags::empty())
    }

    fn contextual_destination(&mut self, file: FileId, e: ExprId) -> Destination {
        match self.declared_contextual_type(file, e) {
            Some(target) => Destination::Typed(target),
            None => Destination::WithParent,
        }
    }

    fn literal_destination(&mut self, file: FileId, literal: ExprId, parent: Parent) -> Destination {
        if let Some(&known) = self.aot.escape_closure.literal_destinations.get(&literal) {
            return known;
        }
        let found = self.destination_of(file, literal, parent);
        self.aot.escape_closure.literal_destinations.insert(literal, found);
        found
    }

    fn destination_of(&mut self, file: FileId, e: ExprId, parent: Parent) -> Destination {
        let hir = self.hir(file);
        match parent {
            Parent::None | Parent::File | Parent::Module(_) => Destination::Nowhere,
            Parent::Expr(around) => self.destination_in_expression(file, e, around),
            Parent::Stmt(stmt) => match hir[stmt].kind {
                StmtKind::Expr(_) | StmtKind::If { .. } | StmtKind::For { .. } | StmtKind::While { .. } | StmtKind::DoWhile { .. } | StmtKind::Switch { .. } => Destination::Nowhere,
                StmtKind::ForIn { .. } | StmtKind::ForOf { .. } => Destination::Nowhere,
                StmtKind::Return(_) => self.contextual_destination(file, e),
                StmtKind::Throw(_) => Destination::Untyped,
                StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_) => Destination::Untyped,
                StmtKind::Empty
                | StmtKind::Debugger
                | StmtKind::Var(_)
                | StmtKind::Fn(_)
                | StmtKind::Class(_)
                | StmtKind::Interface(_)
                | StmtKind::TypeAlias(_)
                | StmtKind::Enum(_)
                | StmtKind::Module(_)
                | StmtKind::Block(_)
                | StmtKind::Try { .. }
                | StmtKind::Break(_)
                | StmtKind::Continue(_)
                | StmtKind::Labeled { .. }
                | StmtKind::Import(_)
                | StmtKind::ImportEquals(_)
                | StmtKind::ExportNamed(_)
                | StmtKind::ExportStar { .. }
                | StmtKind::ExportAsNamespace(_) => Destination::Untyped,
            },
            Parent::VarInit(_) | Parent::ParamDefault(_) | Parent::PatPropDefault(_) | Parent::PatElemDefault(_) | Parent::MemberInit(_) | Parent::FnBody(_) => self.contextual_destination(file, e),
            Parent::Prop(prop) => match hir[prop].kind {
                PropKind::Spread => Destination::Nowhere,
                _ => self.contextual_destination(file, e),
            },
            Parent::PropKey(..) | Parent::PatKey(_) | Parent::MemberKey(_) | Parent::MethodKey(_) => Destination::Nowhere,
            Parent::EnumInit(_) | Parent::Case(_) => Destination::Nowhere,
            Parent::ClassExtends(_) => Destination::Nowhere,
            Parent::Decorator(..) => Destination::Untyped,
        }
    }

    fn destination_in_expression(&mut self, file: FileId, e: ExprId, around: ExprId) -> Destination {
        let hir = self.hir(file);
        match hir[around].kind {
            ExprKind::Missing
            | ExprKind::Ident(_)
            | ExprKind::PrivateIdentifier(_)
            | ExprKind::This
            | ExprKind::Super
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex
            | ExprKind::Fn(_)
            | ExprKind::Class(_)
            | ExprKind::Object(_)
            | ExprKind::ImportMeta
            | ExprKind::NewTarget(_) => Destination::Untyped,
            ExprKind::Template { .. } => Destination::Nowhere,
            ExprKind::TaggedTemplate(call) | ExprKind::Call(call) | ExprKind::New(call) => {
                if hir[call].callee == e {
                    Destination::Nowhere
                } else {
                    self.argument_destination(file, around, call, e)
                }
            }
            ExprKind::Array(_) => self.contextual_destination(file, e),
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                if obj == e {
                    self.receiver_destination(file, e, around)
                } else {
                    Destination::Nowhere
                }
            }
            ExprKind::Unary { op, .. } => match op {
                UnOp::Not | UnOp::Minus | UnOp::Plus | UnOp::BitNot | UnOp::Typeof | UnOp::Void | UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => Destination::Nowhere,
            },
            ExprKind::Binary { op, right, .. } => match op {
                BinOp::And | BinOp::Or | BinOp::Nullish => Destination::WithParent,
                BinOp::Comma if right == e => Destination::WithParent,
                _ => Destination::Nowhere,
            },
            ExprKind::Assign { op, target, value } => {
                if value != e {
                    return Destination::Nowhere;
                }
                match op {
                    None | Some(BinOp::And | BinOp::Or | BinOp::Nullish) => match hir[target].kind {
                        ExprKind::Array(_) | ExprKind::Object(_) => Destination::Untyped,
                        _ if self.is_untyped_code_slot(file, target) => Destination::Untyped,
                        _ => Destination::Typed(self.type_of_expr(file, target)),
                    },
                    Some(_) => Destination::Nowhere,
                }
            }
            ExprKind::Cond { test, .. } => {
                if test == e {
                    Destination::Nowhere
                } else {
                    Destination::WithParent
                }
            }
            ExprKind::Spread(_) => match self.bound(file).expr_parent[around.idx()] {
                Parent::Expr(holder) if matches!(hir[holder].kind, ExprKind::Array(_)) => Destination::WithParent,
                _ => Destination::Untyped,
            },
            ExprKind::Await(_) => Destination::Nowhere,
            ExprKind::Yield { .. } => self.contextual_destination(file, e),
            ExprKind::As { .. } => {
                if self.is_namespace_read_by_name(file, e, around) {
                    return Destination::Nowhere;
                }
                Destination::Typed(self.type_of_expr(file, around))
            }
            ExprKind::Satisfies { .. } | ExprKind::AsConst(_) | ExprKind::NonNull(_) | ExprKind::Instantiation { .. } => Destination::WithParent,
            ExprKind::Jsx(_) => Destination::Untyped,
            ExprKind::ImportCall { .. } => Destination::Untyped,
        }
    }

    fn is_namespace_read_by_name(&mut self, file: FileId, e: ExprId, cast: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::Ident(name) = hir[e].kind else { return false };
        let Parent::Expr(read) = bound.expr_parent[cast.idx()] else { return false };
        let ExprKind::Dot { obj, .. } = hir[read].kind else { return false };
        if obj != cast {
            return false;
        }
        if let Parent::Expr(user) = bound.expr_parent[read.idx()] {
            match hir[user].kind {
                ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) if hir[call].callee == read => return false,
                ExprKind::Assign { target, .. } if target == read => return false,
                ExprKind::Unary { op: UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, .. } => return false,
                _ => {}
            }
        }
        let Some(sym) = self.resolve_identifier(file, e, name, true).ok().flatten() else { return false };
        self.files.decls_of(sym).iter().all(|&(_, decl)| matches!(decl, Decl::ImportNamespace(_)))
    }

    fn callee_kind(&mut self, file: FileId, callee: ExprId, signature: SigId) -> CalleeKind {
        if let Some(&known) = self.aot.escape_closure.callees.get(&callee) {
            return known;
        }
        let kind = self.callee_kind_uncached(file, callee, signature);
        self.aot.escape_closure.callees.insert(callee, kind);
        kind
    }

    fn callee_kind_uncached(&mut self, file: FileId, callee: ExprId, signature: SigId) -> CalleeKind {
        let Some((declared_in, ..)) = self.sig_decl(signature) else { return CalleeKind::Unknown };
        if self.is_untyped_file(declared_in) {
            return CalleeKind::Unknown;
        }
        if self.files.module(declared_in).is_lib
            && let Some((holder, name)) = self.built_in_for_callee(file, callee)
            && !entries_of(self.holder_in_table(holder).0, self.atoms().bytes(name)).is_empty()
        {
            return CalleeKind::BuiltIn(holder, name);
        }
        if self.is_predicted(file, callee) || self.files.module(declared_in).is_lib && !self.is_program_declared_slot(file, callee) {
            return CalleeKind::Unknown;
        }
        CalleeKind::Typed
    }

    fn is_program_declared_slot(&mut self, file: FileId, e: ExprId) -> bool {
        match self.hir(file)[e].kind {
            ExprKind::Ident(name) => self.resolve_identifier(file, e, name, true).ok().flatten().is_some_and(|sym| !self.files.module(sym.file).is_lib),
            ExprKind::Dot { obj, name, .. } => {
                let receiver = self.type_of_expr(file, obj);
                let receiver = self.non_nullable(receiver);
                let parts: Vec<TypeId> = self.parts(receiver).to_vec();
                parts.into_iter().all(|part| {
                    let apparent = self.apparent_type(part);
                    self.members(apparent).is_some_and(|members| match members.resolved.prop(name).map(|prop| &prop.source) {
                        Some(&crate::types::PropSource::Symbol(declared)) => !self.files.module(declared.file).is_lib,
                        Some(_) => true,
                        None => false,
                    })
                })
            }
            ExprKind::NonNull(inner) | ExprKind::As { expr: inner, .. } | ExprKind::Satisfies { expr: inner, .. } => self.is_program_declared_slot(file, inner),
            ExprKind::Index { .. } | ExprKind::Call(_) | ExprKind::Fn(_) | ExprKind::Cond { .. } | ExprKind::Binary { .. } | ExprKind::Assign { .. } | ExprKind::Await(_) => true,
            _ => false,
        }
    }

    fn built_in_for_callee(&mut self, file: FileId, callee: ExprId) -> Option<(Atom, Atom)> {
        match self.hir(file)[callee].kind {
            ExprKind::Dot { obj, name, .. } => {
                if self.is_predicted(file, obj) {
                    return None;
                }
                let receiver = self.type_of_expr(file, obj);
                let receiver = self.non_nullable(receiver);
                let mut holder = Atom::NONE;
                for &part in self.parts(receiver) {
                    let apparent = self.apparent_type(part);
                    let is_function = !self.signatures(part, false).is_empty() || !self.signatures(part, true).is_empty();
                    let of_functions = is_function.then(|| [crate::atom::known::CallableFunction, crate::atom::known::NewableFunction, crate::atom::known::Function].map(|name| self.global_ref(name, &[])));
                    let declared = [apparent].into_iter().chain(of_functions.into_iter().flatten()).find_map(|holding| {
                        self.members(holding).and_then(|members| match members.resolved.prop(name)?.source {
                            crate::types::PropSource::Symbol(declared) => Some(declared),
                            _ => None,
                        })
                    });
                    match declared.filter(|declared| self.files.module(declared.file).is_lib).and_then(|declared| self.declaring_container_name(declared)) {
                        Some(found) if holder.is_none() || holder == found || self.holder_in_table(holder).0 == self.holder_in_table(found).0 => holder = found,
                        _ => return None,
                    }
                }
                holder.is_some().then_some((holder, name))
            }
            ExprKind::Ident(name) => {
                let sym = self.resolve_identifier(file, callee, name, true).ok().flatten()?;
                self.files.module(sym.file).is_lib.then_some((Atom::NONE, name))
            }
            _ => None,
        }
    }

    fn argument_destination(&mut self, file: FileId, call_expr: ExprId, call: CallId, e: ExprId) -> Destination {
        let hir = self.hir(file);
        if matches!(hir[e].kind, ExprKind::Spread(_)) {
            return Destination::Nowhere;
        }
        let Some(signature) = self.resolved_signature(file, call_expr).sig else { return Destination::Untyped };
        match self.callee_kind(file, hir[call].callee, signature) {
            CalleeKind::Unknown => Destination::Untyped,
            CalleeKind::Typed => {
                self.record_call_type_arguments(signature);
                self.record_argument_to_declared_parameter(file, call, e, signature);
                match self.declared_contextual_type(file, e) {
                    Some(target) => Destination::Typed(target),
                    None => Destination::Untyped,
                }
            }
            CalleeKind::BuiltIn(holder, name) => {
                let index = hir.ids(hir[call].args).position(|argument| argument == e).unwrap_or(usize::MAX);
                let is_constructed = matches!(hir[call_expr].kind, ExprKind::New(_));
                let used = self.built_in_operand_uses(file, call, holder, name, is_constructed).map_or(uses::EVERYTHING, |found| found.1.get(index).copied().unwrap_or(uses::EVERYTHING));
                self.builtin_operand_destination(file, call_expr, call, e, used)
            }
        }
    }

    fn record_argument_to_declared_parameter(&mut self, file: FileId, call: CallId, e: ExprId, signature: SigId) {
        let hir = self.hir(file);
        let Some((declared_in, function, _)) = self.sig_decl(signature) else { return };
        let Some(index) = hir.ids(hir[call].args).position(|argument: ExprId| argument == e) else { return };
        if hir.ids(hir[call].args).take(index).any(|argument: ExprId| matches!(hir[argument].kind, ExprKind::Spread(_))) {
            return;
        }
        let Some(parameter) = self.hir(declared_in)[function].params.iter().nth(index) else { return };
        let (own, declared) = (self.type_of_expr(file, e), self.type_of_param(declared_in, parameter));
        self.record_type_parameter_inflow(own, declared);
        if matches!(self.data(declared), TypeData::TypeParam(..)) {
            for part in self.parts(own).to_vec() {
                if !self.declares_properties(part) {
                    continue;
                }
                let record = self.layout_defining_type(part);
                for dictionary in self.dictionaries_wider_than(declared, record) {
                    self.record_stored_read_only(record, dictionary);
                }
            }
        }
        if matches!(self.data(declared), TypeData::TypeParam(..)) && self.is_predicted(file, e) {
            let bound = self.base_constraint(declared);
            let mut views: Vec<TypeId> = Vec::new();
            for part in self.parts(bound).to_vec() {
                if self.declares_properties(part) {
                    views.push(self.layout_defining_type(part));
                }
            }
            self.accepts_untyped(own, &views);
        }
    }

    fn record_call_type_arguments(&mut self, signature: SigId) {
        let Some((.., mapper)) = self.sig_decl(signature) else { return };
        if mapper == MapperId::IDENTITY || !self.aot.escape_closure.bound_at_calls.insert(signature) {
            return;
        }
        let pairs: Vec<(TypeId, TypeId)> = self.types().mapping(mapper).iter().map(|pair| (pair.0, pair.1)).collect();
        for (parameter, argument) in pairs {
            self.record_type_parameter_inflow(argument, parameter);
        }
    }

    fn holder_in_table(&self, holder: Atom) -> (&'static str, bool) {
        if holder.is_none() {
            return ("", false);
        }
        let text = self.atoms().bytes(holder);
        let (text, is_static) = match text.strip_suffix(b"Constructor").filter(|rest| !rest.is_empty()) {
            Some(rest) => (rest, true),
            None => (text, matches!(text, b"Math" | b"JSON" | b"Reflect" | b"Atomics" | b"Console" | b"console")),
        };
        let text = ALIASES.iter().find(|alias| alias.0.as_bytes() == text).map_or(text, |alias| alias.1.as_bytes());
        if TYPED_ARRAYS.iter().any(|known| known.as_bytes() == text) {
            return ("TypedArray", is_static);
        }
        (canonical_holder_name(text).unwrap_or("?"), is_static)
    }

    fn built_in_operand_uses(&mut self, file: FileId, call: CallId, holder: Atom, name: Atom, is_constructed: bool) -> Option<(u16, Rc<[u16]>)> {
        if let Some(known) = self.aot.escape_closure.uses.get(&call) {
            return known.clone();
        }
        let found = self.built_in_operand_uses_uncached(file, call, holder, name, is_constructed).map(|(this, of_arguments)| (this, Rc::from(of_arguments)));
        self.aot.escape_closure.uses.insert(call, found.clone());
        found
    }

    fn built_in_operand_uses_uncached(&mut self, file: FileId, call: CallId, holder: Atom, name: Atom, is_constructed: bool) -> Option<(u16, Vec<u16>)> {
        let hir = self.hir(file);
        let (holder, is_static) = self.holder_in_table(holder);
        let name = self.atoms().bytes(name);
        let is_of_kind = |entry: &BuiltinEntry| match entry.kind {
            BuiltinKind::Function => holder.is_empty() && !is_constructed,
            BuiltinKind::Call => holder.is_empty() && !is_constructed,
            BuiltinKind::Construct => holder.is_empty() && is_constructed,
            BuiltinKind::Static => is_static,
            BuiltinKind::Method => !is_static && !holder.is_empty(),
            BuiltinKind::Getter | BuiltinKind::Setter | BuiltinKind::Intrinsic => false,
        };
        let entries: Vec<&'static BuiltinEntry> = entries_of(holder, name).iter().filter(|entry| entry.holder == holder && entry.name.as_bytes() == name && is_of_kind(entry)).collect();
        if entries.is_empty() {
            return None;
        }
        let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
        let parameter_at = |entry: &BuiltinEntry, index: usize| entry.parameters.get(index).or_else(|| entry.parameters.last().filter(|last| last.1 == Arity::Rest)).copied();
        let has_spread = arguments.iter().any(|&argument| matches!(hir[argument].kind, ExprKind::Spread(_)));
        let types: Vec<TypeId> = arguments.iter().map(|&argument| self.type_of_expr(file, argument)).collect();
        let fitting = entries.iter().copied().find(|entry| {
            let required = entry.parameters.iter().filter(|parameter| parameter.1 == Arity::Required).count();
            !has_spread
                && arguments.len() >= required
                && (0..arguments.len()).all(|index| match parameter_at(entry, index) {
                    None => false,
                    Some((Pattern::Any, ..)) => true,
                    Some((Pattern::Number, ..)) => self.is_number_like(types[index]),
                    Some((Pattern::ToNumber | Pattern::ToString | Pattern::ToPropertyKey, ..)) => self.parts(types[index]).iter().all(|&part| self.has_primitive_flag(part)),
                    Some(_) => false,
                })
        });
        if let Some(entry) = fitting {
            return Some((entry.this, (0..arguments.len()).map(|index| parameter_at(entry, index).map_or(uses::EVERYTHING, |parameter| parameter.2)).collect()));
        }
        let this = entries.iter().fold(0, |all, entry| all | entry.this);
        let anywhere = entries.iter().flat_map(|entry| entry.parameters.iter()).fold(0, |all, parameter| all | parameter.2);
        let of_arguments = (0..arguments.len()).map(|index| if has_spread { anywhere } else { entries.iter().fold(0, |all, entry| all | parameter_at(entry, index).map_or(0, |parameter| parameter.2)) });
        Some((this, of_arguments.collect()))
    }

    fn has_callback_with_untyped_parameters(&mut self, file: FileId, call: CallId) -> bool {
        if let Some(&known) = self.aot.escape_closure.untyped_callbacks.get(&call) {
            return known;
        }
        let has = self.has_callback_with_untyped_parameters_uncached(file, call);
        self.aot.escape_closure.untyped_callbacks.insert(call, has);
        has
    }

    fn has_callback_with_untyped_parameters_uncached(&mut self, file: FileId, call: CallId) -> bool {
        let hir = self.hir(file);
        let mut types: Vec<TypeId> = Vec::new();
        for argument in hir.ids(hir[call].args) {
            types.push(self.type_of_expr(file, argument));
            types.extend(self.declared_contextual_type(file, argument));
        }
        if let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } = hir[hir[call].callee].kind {
            types.push(self.type_of_expr(file, obj));
        }
        types.into_iter().any(|ty| {
            let parts: Vec<TypeId> = self.parts(ty).to_vec();
            parts.into_iter().any(|part| {
                if part.is_any() {
                    return true;
                }
                self.signatures(part, false).iter().copied().any(|signature| {
                    let parameters = self.sig_params(signature);
                    let this = self.sig_this_type(signature);
                    (0..parameters.len()).filter_map(|index| self.param_type_at(&parameters, index)).chain(this).collect::<Vec<TypeId>>().into_iter().any(|parameter| self.is_untyped_for_objects(parameter))
                })
            })
        })
    }

    fn record_dictionaries_stored_through(&mut self, file: FileId, e: ExprId) {
        let own = self.type_of_expr(file, e);
        for dictionary in self.dictionaries_in(own) {
            self.record_read_only_passed_on(dictionary);
        }
    }

    fn built_in_for_function(&mut self, file: FileId, function: ExprId, signature: SigId) -> Option<(Atom, Atom)> {
        if let CalleeKind::BuiltIn(holder, name) = self.callee_kind_uncached(file, function, signature) {
            return Some((holder, name));
        }
        let hir = self.hir(file);
        match hir[function].kind {
            ExprKind::Dot { obj, name, .. } => {
                let ExprKind::Dot { obj: constructor, name: prototype, .. } = hir[obj].kind else { return None };
                let ExprKind::Ident(global) = hir[constructor].kind else { return None };
                if prototype.is_none() || name.is_none() || self.atoms().bytes(prototype) != b"prototype" {
                    return None;
                }
                let sym = self.resolve_identifier(file, constructor, global, true).ok().flatten()?;
                let is_known = self.files.module(sym.file).is_lib && !entries_of(self.holder_in_table(global).0, self.atoms().bytes(name)).is_empty();
                is_known.then_some((global, name))
            }
            ExprKind::Ident(name) => {
                let sym = self.resolve_identifier(file, function, name, true).ok().flatten()?;
                let (declared_in, initializer) = self.initializer_of_const(sym)?;
                self.built_in_for_function(declared_in, initializer, signature)
            }
            _ => None,
        }
    }

    fn only_inspects(&self, holder: Atom, name: Atom) -> bool {
        let (holder, _) = self.holder_in_table(holder);
        let may_store = uses::WRITES_PROPERTIES | uses::HANDS_OVER | uses::KEEPS;
        entries_of(holder, self.atoms().bytes(name)).iter().all(|entry| entry.parameters.iter().fold(entry.this, |all, parameter| all | parameter.2) & may_store == 0)
    }

    fn is_passed_to_read_only_built_in(&mut self, file: FileId, e: ExprId, parent: Parent) -> bool {
        let Parent::Expr(around) = parent else { return false };
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[around].kind else { return false };
        let ExprKind::Dot { obj: function, name, .. } = hir[hir[call].callee].kind else { return false };
        if function == e || name.is_none() || !matches!(self.atoms().bytes(name), b"call" | b"apply") {
            return false;
        }
        let of_function = self.type_of_expr(file, function);
        let signatures: Vec<SigId> = self.signatures(of_function, false).iter().copied().collect();
        !signatures.is_empty() && signatures.into_iter().all(|signature| self.built_in_for_function(file, function, signature).is_some_and(|(holder, name)| self.only_inspects(holder, name)))
    }

    fn may_store_to_operand(&mut self, file: FileId, call: CallId, used: u16) -> bool {
        if used & uses::WRITES_PROPERTIES != 0 {
            return true;
        }
        if used & uses::HANDS_OVER == 0 {
            return false;
        }
        let hir = self.hir(file);
        let mut operands: Vec<ExprId> = Vec::new();
        operands.extend(hir.ids(hir[call].args));
        if let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } = hir[hir[call].callee].kind {
            operands.push(obj);
        }
        operands.into_iter().any(|operand| {
            let ty = self.type_of_expr(file, operand);
            let parts: Vec<TypeId> = self.parts(ty).to_vec();
            parts.into_iter().any(|part| {
                if part.is_any() {
                    return true;
                }
                self.signatures(part, false).iter().copied().any(|signature| {
                    if let Some((holder, name)) = self.built_in_for_function(file, operand, signature) {
                        return !self.only_inspects(holder, name);
                    }
                    let parameters = self.sig_params(signature);
                    let this = self.sig_this_type(signature);
                    (0..parameters.len()).filter_map(|index| self.param_type_at(&parameters, index)).chain(this).collect::<Vec<TypeId>>().into_iter().any(|parameter| self.is_untyped_for_objects(parameter))
                })
            })
        })
    }

    fn builtin_operand_destination(&mut self, file: FileId, call_expr: ExprId, call: CallId, e: ExprId, used: u16) -> Destination {
        self.aot.escape_closure.built_in_operands.insert(e);
        if self.may_store_to_operand(file, call, used) {
            self.record_dictionaries_stored_through(file, e);
        }
        if used == uses::EVERYTHING {
            return Destination::Untyped;
        }
        if used & uses::HANDS_OVER != 0 && self.has_callback_with_untyped_parameters(file, call) {
            return Destination::Untyped;
        }
        let own = self.type_of_expr(file, e);
        let is_result_used = !matches!(self.bound(file).expr_parent[call_expr.idx()], Parent::Stmt(stmt) if matches!(self.hir(file)[stmt].kind, StmtKind::Expr(_)));
        if used & uses::RETURNS != 0 && is_result_used {
            let result = self.type_of_expr(file, call_expr);
            self.record_flow(own, result);
        }
        if used & (uses::KEEPS | uses::CALLS) != 0 && self.hir(file)[call].callee != e && !self.is_receiver_of(file, call, e) {
            return match self.declared_contextual_type(file, e) {
                Some(target) => Destination::Typed(target),
                None => Destination::Untyped,
            };
        }
        Destination::Nowhere
    }

    fn is_receiver_of(&self, file: FileId, call: CallId, e: ExprId) -> bool {
        let hir = self.hir(file);
        matches!(hir[hir[call].callee].kind, ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == e)
    }

    fn receiver_destination(&mut self, file: FileId, e: ExprId, access: ExprId) -> Destination {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Expr(call_expr) = bound.expr_parent[access.idx()] else { return Destination::Nowhere };
        let (ExprKind::Call(call) | ExprKind::TaggedTemplate(call)) = hir[call_expr].kind else { return Destination::Nowhere };
        if hir[call].callee != access {
            return Destination::Nowhere;
        }
        let Some(signature) = self.resolved_signature(file, call_expr).sig else { return Destination::Untyped };
        match self.callee_kind(file, access, signature) {
            CalleeKind::Unknown => Destination::Untyped,
            CalleeKind::Typed => Destination::Nowhere,
            CalleeKind::BuiltIn(holder, name) => {
                let used = self.built_in_operand_uses(file, call, holder, name, false).map_or(uses::EVERYTHING, |found| found.0);
                self.builtin_operand_destination(file, call_expr, call, e, used)
            }
        }
    }

    fn is_untyped_code_slot(&mut self, file: FileId, target: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[target].kind {
            ExprKind::Ident(_) => self.unverified_claim(file, target).is_some(),
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                let is_global_object = matches!(hir[obj].kind, ExprKind::Ident(name) if matches!(self.atoms().bytes(name), b"globalThis" | b"window" | b"self" | b"global")
                    && self.resolve_identifier(file, obj, name, true).ok().flatten().is_none_or(|sym| self.hir(sym.file).kind == FileKind::Declaration));
                is_global_object || self.is_predicted(file, obj) || self.is_declared_by_javascript(file, target) || {
                    let receiver = self.type_of_expr(file, obj);
                    let receiver = self.non_nullable(receiver);
                    let parts: Vec<TypeId> = self.parts(receiver).to_vec();
                    parts.into_iter().any(|part| self.is_nested_too_deeply(part))
                }
            }
            _ => false,
        }
    }

    fn is_declared_by_javascript(&mut self, file: FileId, access: ExprId) -> bool {
        let ExprKind::Dot { obj, name, .. } = self.hir(file)[access].kind else { return false };
        let receiver = self.type_of_expr(file, obj);
        let receiver = self.non_nullable(receiver);
        let parts: Vec<TypeId> = self.parts(receiver).to_vec();
        parts.into_iter().any(|part| {
            let apparent = self.apparent_type(part);
            let declared_in = self.members(apparent).and_then(|members| match members.resolved.prop(name)?.source {
                crate::types::PropSource::Symbol(declared) => Some(declared.file),
                crate::types::PropSource::Literal(declared_in, _) => Some(declared_in),
                _ => None,
            });
            declared_in.is_some_and(|declared_in| self.is_untyped_file(declared_in))
        })
    }

    pub(super) fn name_of_key(&mut self, file: FileId, key: ExprId) -> Atom {
        let ty = self.type_of_expr(file, key);
        match *self.data(ty) {
            TypeData::StringLit { value, .. } => value,
            _ => Atom::NONE,
        }
    }
}
