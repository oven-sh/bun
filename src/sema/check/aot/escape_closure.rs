use super::alterations::Alterations;
use super::int32_fields::RunBy;
use super::builtins_generated::{Arity, BUILTIN_ENTRIES, BuiltinEntry, BuiltinKind, Pattern, uses};
use super::trust::{ALIASES, TYPED_ARRAYS};
use crate::atom::Atom;
use crate::bind::{Decl, Parent};
use crate::check::{Checker, ContextFlags};
use crate::hir::{BinOp, CallId, ExprId, ExprKind, FileKind, PropKind, StmtKind, TypeParamId, UnOp};
use crate::program::{FileId, Sym};
use crate::types::{MapperId, Origin, PropSource, SigId, TypeData, TypeId};
use crate::util::{FxHashMap, FxHashSet};
use std::hash::Hash;
use std::rc::Rc;
use std::sync::OnceLock;

/// A type parameter, by its declaration.
pub(super) type TypeParameter = (FileId, TypeParamId);

pub(crate) struct Escapes<T = TypeId> {
    /// What a built-in may freeze or give another prototype: see `alterations.rs`. `None`: nothing of it has been noted. It is large, and this is in the notes of every function.
    pub(super) alterations: Option<Box<Alterations<T>>>,
}

impl<T> Default for Escapes<T> {
    fn default() -> Escapes<T> {
        Escapes { alterations: None }
    }
}

impl<T: Copy + Eq + Hash> Escapes<T> {
    pub(super) fn with_alterations<R>(&self, read: impl FnOnce(&Alterations<T>) -> R) -> R {
        match &self.alterations {
            Some(noted) => read(noted),
            None => read(&Alterations::default()),
        }
    }

    pub(super) fn absorb(&mut self, other: Escapes<T>) {
        if let Some(noted) = other.alterations {
            self.alterations.get_or_insert_with(Default::default).absorb(*noted);
        }
    }

    pub(super) fn renamed<U: Copy + Eq + Hash>(self, rename: &mut impl FnMut(T) -> Option<U>) -> Escapes<U> {
        Escapes { alterations: self.alterations.map(|noted| Box::new(noted.renamed(rename))) }
    }
}

/// Where the value of an expression goes.
#[derive(Copy, Clone)]
enum Entered {
    /// It is used up where it stands: tested, converted, called, read from.
    Nowhere,
    /// It is, or is among, what the expression around it yields, whose type has the type of this one in it.
    WithParent,
    /// A place of this type.
    Typed(TypeId),
    Untyped,
}

/// What is known of the function that a call calls.
#[derive(Copy, Clone)]
enum CalleeKind {
    /// A function of the program, or whatever is in a place of a function type: it goes by the signature.
    Typed,
    /// The engine implements it: the interface of `lib.*.d.ts` that declares it, `NONE` for a global, and the name.
    BuiltIn(Atom, Atom),
    Unknown,
}

/// What has been noted for the file that is gone through. What is noted goes with the module, and a module that is not in the program is
/// dropped: nothing is left out for a file because another has noted it.
#[derive(Default)]
pub(super) struct State {
    /// The pairs of types between which a flow has been noted.
    flows: FxHashSet<(TypeId, TypeId)>,
    entered_by_any: FxHashSet<TypeId>,
    parameters_among_carried: Vec<u32>,
    /// The same for `note_entering_type_parameters`.
    pub(super) entered: FxHashSet<(TypeId, TypeId)>,
    pub(super) entered_views: FxHashSet<(TypeId, TypeId)>,
    pub(super) entered_untyped_places: FxHashSet<(TypeId, Option<TypeId>)>,
    /// The instantiations and the signatures whose type arguments have been noted.
    bound: FxHashSet<TypeId>,
    bound_at_calls: FxHashSet<SigId>,
    /// By what is called, and by call: it is asked for each argument.
    callees: FxHashMap<ExprId, CalleeKind>,
    uses: FxHashMap<CallId, Option<(u16, Rc<[u16]>)>>,
    untyped_callbacks: FxHashMap<CallId, bool>,
    entered_by_literals: FxHashMap<ExprId, Entered>,
}

/// The entries of `BUILTIN_ENTRIES` for the holder and the name, of whatever kind: those of one built-in are adjacent.
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

/// The holder as `BUILTIN_ENTRIES` spells it.
fn holder_named(text: &[u8]) -> Option<&'static str> {
    static HOLDERS: OnceLock<FxHashMap<&'static [u8], &'static str>> = OnceLock::new();
    HOLDERS.get_or_init(|| BUILTIN_ENTRIES.iter().map(|entry| (entry.holder.as_bytes(), entry.holder)).collect()).get(text).copied()
}

/// As many flows may carry a flow within them.
const MOST_NESTED_FLOWS: u32 = 3;

/// As many pairs of parts of two unions are looked at one by one.
const MAX_PAIRS_OF_PARTS: usize = 64;

impl<'p, 's> Checker<'p, 's> {
    /// A value of type `source` enters a place of type `target`.
    fn note_flow(&mut self, source: TypeId, target: TypeId) {
        self.note_flow_within(source, target, 0);
    }

    /// `depth`: how many flows carry this one within them.
    fn note_flow_within(&mut self, source: TypeId, target: TypeId, depth: u32) {
        self.note_carried_flow(source, target, depth, false);
    }

    fn note_carried_flow(&mut self, source: TypeId, target: TypeId, depth: u32, is_parameter_without_second_body: bool) {
        if is_parameter_without_second_body && !target.is_never() && self.is_any_like(source) && self.aot.escape_closure.entered_by_any.insert(target) {
            self.note_any_inflow_into_records_in(target);
        }
        // There is no value of type `never`: the elements of `[]`.
        if source == target || source.is_never() || target.is_never() || !self.aot.escape_closure.flows.insert((source, target)) {
            return;
        }
        self.note_entering_type_parameters(source, target);
        if self.says_nothing_of_objects(target) || self.says_nothing_of_objects(source) || depth > MOST_NESTED_FLOWS {
            return;
        }
        let carried = self.flows_carried_by(source, target);
        let number_of_parameters = carried.last().map_or(0, |&(_, number)| number.0 as usize);
        let number_of_flows = carried.len() - 1 - number_of_parameters;
        for (index, &(held, held_as)) in carried[..number_of_flows].iter().enumerate() {
            let is_parameter = carried[number_of_flows..carried.len() - 1].iter().any(|&(_, parameter)| parameter.0 as usize == index);
            self.note_carried_flow(held, held_as, depth + 1, is_parameter);
        }
    }

    fn flows_carried_by(&mut self, source: TypeId, target: TypeId) -> Rc<[(TypeId, TypeId)]> {
        let may_be_kept = !self.answers_are_provisional();
        if may_be_kept && let Some(known) = self.aot.flows.carried.get(&(source, target)) {
            return Rc::clone(known);
        }
        let careful_before = (self.times_half_of_stack_was_in_use(), self.aot.flows.times_not_known);
        let mut carried = Vec::new();
        let of_outer_flow = std::mem::take(&mut self.aot.escape_closure.parameters_among_carried);
        self.add_carried_flows(source, target, &mut carried);
        let parameters = std::mem::replace(&mut self.aot.escape_closure.parameters_among_carried, of_outer_flow);
        let number_of_parameters = parameters.len() as u32;
        carried.extend(parameters.into_iter().map(|index| (TypeId::NEVER, TypeId(index))));
        carried.push((TypeId::NEVER, TypeId(number_of_parameters)));
        let carried: Rc<[(TypeId, TypeId)]> = carried.into();
        if may_be_kept && careful_before == (self.times_half_of_stack_was_in_use(), self.aot.flows.times_not_known) {
            self.aot.flows.carried.insert((source, target), Rc::clone(&carried));
        }
        carried
    }

    /// `any`, `unknown`, `object`, `{}`, `Object`, `Function`, `void`: whoever has a value of it as that may do anything to it.
    pub(super) fn says_nothing_of_objects(&mut self, ty: TypeId) -> bool {
        if self.says_nothing(ty) {
            return true;
        }
        let may_be_kept = !self.answers_are_provisional();
        if may_be_kept && let Some(&known) = self.aot.flows.saying_nothing_of_objects.get(&ty) {
            return known;
        }
        let careful_before = (self.times_half_of_stack_was_in_use(), self.aot.flows.times_not_known);
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        let found = parts.into_iter().any(|part| self.says_nothing(part) && !part.is_never() || part == TypeId::OBJECT || !self.is_instantiable(part) && self.admits_primitives(part) || self.is_nested_too_deeply(part) || self.is_the_function_type(part));
        if may_be_kept && careful_before == (self.times_half_of_stack_was_in_use(), self.aot.flows.times_not_known) {
            self.aot.flows.saying_nothing_of_objects.insert(ty, found);
        }
        found
    }

    fn is_the_function_type(&mut self, ty: TypeId) -> bool {
        let known = match self.aot.flows.function_types {
            Some(known) => known,
            None => {
                let found = [crate::atom::known::Function, crate::atom::known::CallableFunction, crate::atom::known::NewableFunction].map(|name| self.global_ref(name, &[]));
                *self.aot.flows.function_types.insert(found)
            }
        };
        known.contains(&ty)
    }

    /// The flows that a flow between two types that both say something carries within it.
    fn add_carried_flows(&mut self, source: TypeId, target: TypeId, carried: &mut Vec<(TypeId, TypeId)>) {
        let to_parts: Vec<TypeId> = self.parts(target).iter().copied().filter(|&part| !self.has_primitive_flag(part)).collect();
        // A part that both have stays in a place of its own type: what is left of a union that has been narrowed.
        let in_target: FxHashSet<TypeId> = to_parts.iter().copied().collect();
        let from_parts: Vec<TypeId> = self.parts(source).iter().copied().filter(|part| !self.has_primitive_flag(*part) && !in_target.contains(part)).collect();
        if from_parts.len() * to_parts.len() <= MAX_PAIRS_OF_PARTS {
            for &from in &from_parts {
                for &to in &to_parts {
                    self.add_carried_between(from, to, carried);
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
                self.add_carried_between(from, to, carried);
            }
        }
    }

    /// `from`, `to`: neither is a union.
    fn add_carried_between(&mut self, from: TypeId, to: TypeId, carried: &mut Vec<(TypeId, TypeId)>) {
        if let (TypeData::Ref { target: declared, .. }, TypeData::Ref { target: as_declared, .. }) = (self.data(from), self.data(to))
            && declared == as_declared
        {
            let pairs: Vec<(TypeId, TypeId)> = self.type_arguments(from).iter().copied().zip(self.type_arguments(to).iter().copied()).collect();
            for (held, held_as) in pairs {
                carried.extend([(held, held_as), (held_as, held)]);
            }
            return;
        }
        for key in [TypeId::NUMBER, TypeId::STRING] {
            if let (Some(held), Some(held_as)) = (self.index_type_of_type(from, key), self.index_type_of_type(to, key)) {
                carried.extend([(held, held_as), (held_as, held)]);
            }
        }
        self.add_flows_of_function_members(from, to, carried);
        for constructs in [false, true] {
            let called_as_all: Vec<SigId> = self.signatures(to, constructs).iter().copied().collect();
            let declared_as_all: Vec<SigId> = self.signatures(from, constructs).iter().copied().collect();
            for &called_as in &called_as_all {
                let arguments = self.sig_params(called_as);
                for &declared_as in &declared_as_all {
                    let parameters = self.sig_params(declared_as);
                    let is_served = self.is_served_by_a_second_body(declared_as);
                    for index in 0..parameters.len() {
                        if let (Some(argument), Some(parameter)) = (self.param_type_at(&arguments, index), self.param_type_at(&parameters, index)) {
                            if !is_served {
                                self.aot.escape_closure.parameters_among_carried.push(carried.len() as u32);
                            }
                            carried.push((argument, parameter));
                        }
                    }
                    let (yielded, produced_as) = (self.sig_return(declared_as), self.sig_return(called_as));
                    carried.push((yielded, produced_as));
                }
            }
        }
    }

    /// An object of type `from` is looked at as `to` says. A function in a member of it is read as the one type and stored as the other. What
    /// else the members hold is seen to by the subtype sets.
    fn add_flows_of_function_members(&mut self, from: TypeId, to: TypeId, carried: &mut Vec<(TypeId, TypeId)>) {
        if !self.says_properties(from) || !self.says_properties(to) {
            return;
        }
        if self.is_declared_by_a_package(from) || self.is_declared_by_a_package(to) {
            return;
        }
        let (Some(of_from), Some(of_to)) = (self.members(from), self.members(to)) else { return };
        for as_prop in of_to.shape().props.iter() {
            let Some(prop) = of_from.resolved.prop(as_prop.name) else { continue };
            // One declaration, as where the one type extends the other: one type.
            if let (&PropSource::Symbol(declared), &PropSource::Symbol(as_declared)) = (&prop.source, &as_prop.source)
                && declared == as_declared
                && of_from.mapper == of_to.mapper
            {
                continue;
            }
            let (held, held_as) = (self.type_of_prop(prop, of_from.mapper), self.type_of_prop(as_prop, of_to.mapper));
            let may_be_function = |this: &mut Self, ty: TypeId| this.parts(ty).to_vec().into_iter().any(|part| !this.signatures(part, false).is_empty() || !this.signatures(part, true).is_empty());
            if held != held_as && may_be_function(self, held) && may_be_function(self, held_as) {
                carried.extend([(held, held_as), (held_as, held)]);
            }
        }
    }

    /// Whether a declaration file that is not of the language declares the type: a package, the host.
    fn is_declared_by_a_package(&self, ty: TypeId) -> bool {
        let declared_in = match *self.data(ty) {
            TypeData::Ref { target, .. } => target.file,
            TypeData::Anon { origin: Origin::TypeLiteral(file, _) | Origin::Mapped(file, _), .. } => file,
            _ => return false,
        };
        self.hir(declared_in).kind == FileKind::Declaration && !self.files.module(declared_in).is_lib
    }

    /// The type arguments of the instantiations in the type are put in for the type parameters of what they instantiate.
    fn note_type_arguments_in(&mut self, ty: TypeId) {
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        for part in parts {
            let TypeData::Ref { target, .. } = *self.data(part) else { continue };
            if !self.aot.escape_closure.bound.insert(part) {
                continue;
            }
            let parameters: Vec<TypeId> = self.type_params_of_symbol(target).iter().copied().collect();
            let arguments: Vec<TypeId> = self.type_arguments(part).to_vec();
            for (parameter, argument) in parameters.into_iter().zip(arguments) {
                self.note_entering_type_parameters(argument, parameter);
            }
        }
    }

    // ───────────────────────────── the expressions of a file ─────────────────────────────

    /// Takes note of where the value of every expression of the file goes.
    pub fn note_escapes_in(&mut self, file: FileId) {
        let hir = self.hir(file);
        if hir.kind == FileKind::Declaration {
            return;
        }
        // Host code, to whatever is found out about the types of the program.
        if self.files.module(file).is_opaque() {
            return;
        }
        self.aot.escape_closure = State::default();
        if self.is_untyped_file(file) {
            self.note_alterations_by_javascript(file);
        }
    }

    fn code_evaluating(&self, file: FileId, mut parent: Parent) -> RunBy {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            parent = match parent {
                Parent::Expr(e) if e.is_some() => bound.expr_parent[e.idx()],
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                Parent::FnBody(func) => return RunBy::Function(func),
                Parent::ParamDefault(p) => return RunBy::Function(bound.param_fn[p.idx()]),
                Parent::MemberKey(member) => match bound.member_owner[member.idx()] {
                    crate::bind::MemberOwner::Class(class) => bound.class_owner[class.idx()].to_parent(),
                    _ => return RunBy::Module,
                },
                Parent::Decorator(class, _) => bound.class_owner[class.idx()].to_parent(),
                Parent::MethodKey(prop) => Parent::Expr(bound.prop_owner[prop.idx()]),
                Parent::MemberInit(member) if !hir[member].flags.contains(crate::hir::Flags::STATIC) => match bound.member_owner[member.idx()] {
                    crate::bind::MemberOwner::Class(class) => return RunBy::ConstructorOf(class),
                    _ => return RunBy::Module,
                },
                Parent::File | Parent::None => return RunBy::Module,
                _ => self.parent_of_node(file, parent),
            };
        }
    }

    pub fn are_escapes_noted_of(&self, file: FileId) -> bool {
        self.hir(file).kind != FileKind::Declaration && !self.files.module(file).is_opaque() && !self.is_untyped_file(file)
    }

    pub fn code_whose_escapes_are_noted(&mut self, file: FileId) -> Vec<(RunBy, Vec<ExprId>)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !self.are_escapes_noted_of(file) {
            return Vec::new();
        }
        let rank = |by: RunBy| match by {
            RunBy::Module => (0, 0),
            RunBy::Function(func) => (1, func.0),
            RunBy::ConstructorOf(class) => (2, class.0),
        };
        let mut run_by: Vec<Option<RunBy>> = vec![None; hir.exprs.len()];
        let mut on_the_way: Vec<ExprId> = Vec::new();
        for e in (0..hir.exprs.len() as u32).map(ExprId) {
            let mut at = e;
            let found = loop {
                if let Some(known) = run_by[at.idx()] {
                    break known;
                }
                on_the_way.push(at);
                match bound.expr_parent[at.idx()] {
                    Parent::Expr(around) if around.is_some() => at = around,
                    parent => break self.code_evaluating(file, parent),
                }
            };
            for passed in on_the_way.drain(..) {
                run_by[passed.idx()] = Some(found);
            }
        }
        let mut all: Vec<(RunBy, ExprId)> = run_by.into_iter().enumerate().filter_map(|(e, by)| Some((by?, ExprId(e as u32)))).collect();
        all.sort_by_key(|&(by, _)| rank(by));
        all.chunk_by(|one, other| one.0 == other.0).map(|group| (group[0].0, group.iter().map(|it| it.1).collect())).collect()
    }

    pub fn note_escapes_of(&mut self, file: FileId, expressions: &[ExprId]) {
        self.aot.escape_closure = State::default();
        for &e in expressions {
            self.note_escape_of(file, e);
        }
    }

    fn note_escape_of(&mut self, file: FileId, e: ExprId) {
        let bound = self.bound(file);
        let parent = bound.expr_parent[e.idx()];
        if parent == Parent::None || bound.is_in_type_query(e) {
            return;
        }
        self.note_alteration_by(file, e);
        self.note_method_as_value(file, e, parent);
        self.note_instanceof_operands(file, e);
        if self.leaks_its_prototype(file, e, parent) {
            let shown = self.type_shown_by(file, e, 0);
            self.note_what_is_let_out(shown, None);
        }
        let entered = if matches!(self.hir(file)[e].kind, ExprKind::Object(_)) { self.place_entered_by_literal(file, e, parent) } else { self.place_entered_by(file, e, parent) };
        match entered {
            Entered::Nowhere => {}
            Entered::Typed(target) => self.note_built_in_as_value(file, e, Some(target)),
            Entered::Untyped => self.note_built_in_as_value(file, e, None),
            // A variable, a property, a function without an annotation has the type of what it is given.
            Entered::WithParent => {
                let around = if let Parent::Expr(around) = parent { around } else { e };
                let target = self.type_of_expr(file, around);
                self.note_built_in_as_value(file, e, Some(target));
            }
        }
        if let Parent::Prop(prop) = parent
            && !matches!(entered, Entered::Nowhere)
        {
            let held = self.type_of_expr(file, e);
            let mut literal = bound.prop_owner[prop.idx()];
            for _ in 0..8 {
                let of_literal = self.type_of_expr(file, literal);
                if self.says_nothing(of_literal) {
                    self.note_what_enters_a_place_that_says_nothing(held, None);
                    break;
                }
                let around = bound.expr_parent[literal.idx()];
                match self.place_entered_by_literal(file, literal, around) {
                    Entered::Untyped => self.note_what_enters_a_place_that_says_nothing(held, None),
                    Entered::Typed(target) => self.note_what_enters_a_place_that_says_nothing(held, Some(target)),
                    Entered::Nowhere | Entered::WithParent => {}
                }
                let Parent::Prop(above) = around else { break };
                literal = bound.prop_owner[above.idx()];
            }
        }
        if matches!(entered, Entered::Nowhere | Entered::WithParent) {
            return;
        }
        let own = self.type_of_expr(file, e);
        self.note_what_enters_a_place_that_says_nothing(own, if let Entered::Typed(target) = entered { Some(target) } else { None });
        let is_handed_over = matches!(parent, Parent::Expr(around) if matches!(self.hir(file)[around].kind, ExprKind::Call(_) | ExprKind::New(_) | ExprKind::TaggedTemplate(_) | ExprKind::Dot { .. } | ExprKind::Index { .. }));
        if is_handed_over && matches!(entered, Entered::Untyped) && !self.is_this_in_method_of_own_class(file, e, parent) {
            let shown = self.type_shown_by(file, e, 0);
            self.note_what_is_let_out(shown, None);
            self.note_function_parameter_types(file, e, shown);
        }
        if let Entered::Typed(target) = entered
            && self.says_nothing(own)
            && self.origin_of_data(file, e).is_some()
        {
            self.note_what_is_let_out(target, None);
            self.note_type_admits_foreign_objects(target, false);
        }
        if let Entered::Typed(target) = entered
            && !self.says_nothing(own)
            && self.parts(target).iter().any(|&part| self.is_type_of_instances(part) || matches!(*self.data(part), TypeData::TypeParam(..)))
            && self.is_predicted(file, e)
        {
            self.note_type_admits_foreign_objects(target, true);
        }
        self.note_type_arguments_in(own);
        if let Entered::Typed(target) = entered {
            self.note_type_arguments_in(target);
            self.note_flow(own, target);
            self.note_instances_entering_views(own, target);
        }
    }

    fn note_instanceof_operands(&mut self, file: FileId, e: ExprId) {
        let ExprKind::Binary { op: BinOp::Instanceof, left, right } = self.hir(file)[e].kind else { return };
        let asked = self.type_of_expr(file, left);
        let asked = self.non_nullable(asked);
        if self.parts(asked).iter().all(|&part| self.is_type_of_instances(part)) {
            return;
        }
        let class = self.type_of_expr(file, right);
        let signatures: Vec<SigId> = self.signatures(class, true).iter().copied().collect();
        for signature in signatures {
            let made = self.sig_return(signature);
            self.note_type_admits_foreign_objects(made, true);
        }
    }

    fn note_function_parameter_types(&mut self, file: FileId, e: ExprId, shown: TypeId) {
        let is_tested_at_the_entry = matches!(self.hir(file)[e].kind, ExprKind::Fn(func) if self.has_second_body(file, func));
        let mut seen: FxHashSet<TypeId> = FxHashSet::default();
        for part in self.parts(shown).to_vec() {
            let signatures: Vec<SigId> = self.signatures(part, false).iter().copied().collect();
            for signature in signatures {
                let taken: Vec<TypeId> = self.sig_params(signature).iter().map(|parameter| parameter.ty).collect();
                for ty in taken {
                    self.note_what_enters_within(ty, 0, is_tested_at_the_entry, &mut seen);
                }
            }
        }
    }

    fn note_what_enters_within(&mut self, ty: TypeId, depth: u32, is_tested: bool, seen: &mut FxHashSet<TypeId>) {
        if depth > 3 || (!is_tested && !seen.insert(ty)) {
            return;
        }
        if !is_tested {
            self.note_type_admits_foreign_objects(ty, true);
        }
        for part in self.parts(ty).to_vec() {
            if self.is_type_of_instances(part) {
                continue;
            }
            if let TypeData::Ref { .. } = *self.data(part) {
                for argument in self.type_arguments(part).to_vec() {
                    self.note_what_enters_within(argument, depth + 1, false, seen);
                }
            } else if self.is_object_type(part) && self.signatures(part, false).is_empty() {
                let Some(members) = self.members(part) else { continue };
                for prop in members.shape().props.iter() {
                    let held = self.type_of_prop(prop, members.mapper);
                    self.note_what_enters_within(held, depth + 1, false, seen);
                }
            }
        }
    }

    fn leaks_its_prototype(&mut self, file: FileId, e: ExprId, parent: Parent) -> bool {
        let hir = self.hir(file);
        let Parent::Expr(around) = parent else { return false };
        let (ExprKind::Call(call) | ExprKind::New(call)) = hir[around].kind else { return false };
        let callee = hir[call].callee;
        if callee == e {
            return false;
        }
        match hir[callee].kind {
            ExprKind::Dot { obj, name, .. } => match self.atoms().bytes(name) {
                b"create" => self.names_global_object(file, obj, b"Object"),
                b"construct" => self.names_global_object(file, obj, b"Reflect"),
                b"getPrototypeOf" | b"setPrototypeOf" => self.names_global_object(file, obj, b"Object") || self.names_global_object(file, obj, b"Reflect"),
                _ => false,
            },
            ExprKind::Ident(_) => matches!(hir[around].kind, ExprKind::New(_)) && self.names_global_object(file, callee, b"Proxy"),
            _ => false,
        }
    }

    fn type_shown_by(&mut self, file: FileId, e: ExprId, depth: u32) -> TypeId {
        let own = self.type_of_expr(file, e);
        if !self.says_nothing(own) || depth > 8 {
            return own;
        }
        match self.hir(file)[e].kind {
            ExprKind::As { expr, .. } | ExprKind::NonNull(expr) | ExprKind::Satisfies { expr, .. } => self.type_shown_by(file, expr, depth + 1),
            ExprKind::Ident(name) => {
                let Some(sym) = self.symbol_of_identifier(file, e, name) else { return own };
                let Some((of, Decl::Var(pat))) = self.files().value_declaration(sym) else { return own };
                let (hir, bound) = (self.hir(of), self.bound(of));
                let crate::bind::PatParent::Var(d) = bound.pat_parent[pat.idx()] else { return own };
                if hir[d].pat != pat || hir[d].init.is_none() || !bound.assignments_to(bound.pat_symbol[pat.idx()]).is_empty() {
                    return own;
                }
                self.type_shown_by(of, hir[d].init, depth + 1)
            }
            _ => own,
        }
    }

    fn note_method_as_value(&mut self, file: FileId, e: ExprId, parent: Parent) {
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
        let given = bound_to.map(|to| self.type_given_as_this(file, to));
        let receiver = self.type_of_expr(file, obj);
        let receiver = self.non_nullable(receiver);
        for part in self.parts(receiver).to_vec() {
            if !self.is_type_of_instances(part) || !self.members(part).is_some_and(|members| members.resolved.prop(name).is_some_and(|prop| prop.flags.contains(crate::types::PropFlags::METHOD))) {
                continue;
            }
            let is_bound_to_its_like = given.is_some_and(|given| self.is_object_of_class(given, part));
            if !is_bound_to_its_like {
                self.note_what_is_let_out(part, None);
            }
        }
    }

    fn type_given_as_this(&mut self, file: FileId, mut to: ExprId) -> TypeId {
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
        self.parts(given).to_vec().into_iter().all(|of| self.is_type_of_instances(of)) && self.is_assignable(given, class)
    }

    fn is_this_in_method_of_own_class(&mut self, file: FileId, e: ExprId, parent: Parent) -> bool {
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
        let given = self.type_given_as_this(file, e);
        let receiver = self.type_of_expr(file, obj);
        let receiver = self.non_nullable(receiver);
        let parts = self.parts(receiver).to_vec();
        !parts.is_empty()
            && parts.into_iter().all(|part| {
                self.is_type_of_instances(part)
                    && self.members(part).is_some_and(|members| members.resolved.prop(name).is_some_and(|prop| prop.flags.contains(crate::types::PropFlags::METHOD)))
                    && self.is_object_of_class(given, part)
            })
    }

    /// The type of where the value of `e` goes, as it is declared: a type parameter and not what it is bound by.
    fn declared_contextual_type(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        self.prepare_enclosing(file, e);
        self.contextual_type(file, e, ContextFlags::empty())
    }

    /// The contextual type, or the place is of the type of the value itself.
    fn contextual_place(&mut self, file: FileId, e: ExprId) -> Entered {
        match self.declared_contextual_type(file, e) {
            Some(target) => Entered::Typed(target),
            None => Entered::WithParent,
        }
    }

    fn place_entered_by_literal(&mut self, file: FileId, literal: ExprId, parent: Parent) -> Entered {
        if let Some(&known) = self.aot.escape_closure.entered_by_literals.get(&literal) {
            return known;
        }
        let found = self.place_entered_by(file, literal, parent);
        self.aot.escape_closure.entered_by_literals.insert(literal, found);
        found
    }

    fn place_entered_by(&mut self, file: FileId, e: ExprId, parent: Parent) -> Entered {
        let hir = self.hir(file);
        match parent {
            Parent::None | Parent::File | Parent::Module(_) => Entered::Nowhere,
            Parent::Expr(around) => self.place_in_expression(file, e, around),
            Parent::Stmt(stmt) => match hir[stmt].kind {
                StmtKind::Expr(_) | StmtKind::If { .. } | StmtKind::For { .. } | StmtKind::While { .. } | StmtKind::DoWhile { .. } | StmtKind::Switch { .. } => Entered::Nowhere,
                // The keys are strings. What is iterated over hands its elements to a binding of their type.
                StmtKind::ForIn { .. } | StmtKind::ForOf { .. } => Entered::Nowhere,
                StmtKind::Return(_) => self.contextual_place(file, e),
                StmtKind::Throw(_) => Entered::Untyped,
                // Whoever imports it has it as its type. The host has the exports of the entry point.
                StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_) => Entered::Untyped,
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
                | StmtKind::ExportAsNamespace(_) => Entered::Untyped,
            },
            Parent::VarInit(_) | Parent::ParamDefault(_) | Parent::PatPropDefault(_) | Parent::PatElemDefault(_) | Parent::MemberInit(_) | Parent::FnBody(_) => self.contextual_place(file, e),
            Parent::Prop(prop) => match hir[prop].kind {
                PropKind::Spread => Entered::Nowhere,
                _ => self.contextual_place(file, e),
            },
            // Converted to a property key.
            Parent::PropKey(..) | Parent::PatKey(_) | Parent::MemberKey(_) | Parent::MethodKey(_) => Entered::Nowhere,
            Parent::EnumInit(_) | Parent::Case(_) => Entered::Nowhere,
            // The class is constructed by what extends it, which is typed code.
            Parent::ClassExtends(_) => Entered::Nowhere,
            Parent::Decorator(..) => Entered::Untyped,
        }
    }

    fn place_in_expression(&mut self, file: FileId, e: ExprId, around: ExprId) -> Entered {
        let hir = self.hir(file);
        match hir[around].kind {
            // These have no operands.
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
            | ExprKind::NewTarget(_) => Entered::Untyped,
            // Converted to a string, by typed code if by any.
            ExprKind::Template { .. } => Entered::Nowhere,
            ExprKind::TaggedTemplate(call) | ExprKind::Call(call) | ExprKind::New(call) => {
                if hir[call].callee == e {
                    Entered::Nowhere
                } else {
                    self.place_of_argument(file, around, call, e)
                }
            }
            ExprKind::Array(_) => self.contextual_place(file, e),
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                if obj == e {
                    self.place_of_receiver(file, e, around)
                } else {
                    Entered::Nowhere
                }
            }
            ExprKind::Unary { op, .. } => match op {
                UnOp::Not | UnOp::Minus | UnOp::Plus | UnOp::BitNot | UnOp::Typeof | UnOp::Void | UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => Entered::Nowhere,
            },
            ExprKind::Binary { op, right, .. } => match op {
                BinOp::And | BinOp::Or | BinOp::Nullish => Entered::WithParent,
                BinOp::Comma if right == e => Entered::WithParent,
                _ => Entered::Nowhere,
            },
            ExprKind::Assign { op, target, value } => {
                if value != e {
                    return Entered::Nowhere;
                }
                match op {
                    None | Some(BinOp::And | BinOp::Or | BinOp::Nullish) => match hir[target].kind {
                        // A pattern: its parts go to targets that are not looked at one by one.
                        ExprKind::Array(_) | ExprKind::Object(_) => Entered::Untyped,
                        _ if self.is_place_of_untyped_code(file, target) => Entered::Untyped,
                        _ => Entered::Typed(self.type_of_expr(file, target)),
                    },
                    Some(_) => Entered::Nowhere,
                }
            }
            ExprKind::Cond { test, .. } => {
                if test == e {
                    Entered::Nowhere
                } else {
                    Entered::WithParent
                }
            }
            ExprKind::Spread(_) => match self.bound(file).expr_parent[around.idx()] {
                Parent::Expr(holder) if matches!(hir[holder].kind, ExprKind::Array(_)) => Entered::WithParent,
                _ => Entered::Untyped,
            },
            // What a promise is settled with is of the type it says.
            ExprKind::Await(_) => Entered::Nowhere,
            ExprKind::Yield { .. } => self.contextual_place(file, e),
            ExprKind::As { .. } => {
                // `(namespace as any).Name` reads one binding, and the object goes nowhere else.
                if self.is_namespace_read_by_name(file, e, around) {
                    return Entered::Nowhere;
                }
                Entered::Typed(self.type_of_expr(file, around))
            }
            ExprKind::Satisfies { .. } | ExprKind::AsConst(_) | ExprKind::NonNull(_) | ExprKind::Instantiation { .. } => Entered::WithParent,
            ExprKind::Jsx(_) => Entered::Untyped,
            ExprKind::ImportCall { .. } => Entered::Untyped,
        }
    }

    /// `e`: the name of a namespace import. `cast`: `e as T`. Whether that is the object of `(e as T).Name`, which is not called.
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

    fn kind_of_callee(&mut self, file: FileId, callee: ExprId, signature: SigId) -> CalleeKind {
        if let Some(&known) = self.aot.escape_closure.callees.get(&callee) {
            return known;
        }
        let kind = self.kind_of_callee_uncached(file, callee, signature);
        self.aot.escape_closure.callees.insert(callee, kind);
        kind
    }

    fn kind_of_callee_uncached(&mut self, file: FileId, callee: ExprId, signature: SigId) -> CalleeKind {
        let Some((declared_in, ..)) = self.sig_decl(signature) else { return CalleeKind::Unknown };
        if self.is_untyped_file(declared_in) {
            return CalleeKind::Unknown;
        }
        // A signature of `lib.*.d.ts`: a built-in, unless it is only the type of a place of the program. The globals of the language are
        // read-only and keep what they have, so what is read from one by name is what the engine put there.
        if self.files.module(declared_in).is_lib
            && let Some((holder, name)) = self.built_in_named_by(file, callee)
            && !entries_of(self.holder_in_table(holder).0, self.atoms().bytes(name)).is_empty()
        {
            return CalleeKind::BuiltIn(holder, name);
        }
        if self.is_predicted(file, callee) || self.files.module(declared_in).is_lib && !self.is_place_of_the_program(file, callee) {
            return CalleeKind::Unknown;
        }
        CalleeKind::Typed
    }

    /// Whether what the expression yields comes out of a place that the program declares, whatever declares the type of that: a variable,
    /// a parameter, a property, an element, what a call yields. Not a property that `lib.*.d.ts` declares, nor a global of it.
    fn is_place_of_the_program(&mut self, file: FileId, e: ExprId) -> bool {
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
            ExprKind::NonNull(inner) | ExprKind::As { expr: inner, .. } | ExprKind::Satisfies { expr: inner, .. } => self.is_place_of_the_program(file, inner),
            ExprKind::Index { .. } | ExprKind::Call(_) | ExprKind::Fn(_) | ExprKind::Cond { .. } | ExprKind::Binary { .. } | ExprKind::Assign { .. } | ExprKind::Await(_) => true,
            _ => false,
        }
    }

    /// The interface of `lib.*.d.ts` that declares what the expression reads, `NONE` for a global, and the name.
    fn built_in_named_by(&mut self, file: FileId, callee: ExprId) -> Option<(Atom, Atom)> {
        match self.hir(file)[callee].kind {
            ExprKind::Dot { obj, name, .. } => {
                if self.is_predicted(file, obj) {
                    return None;
                }
                let receiver = self.type_of_expr(file, obj);
                let receiver = self.non_nullable(receiver);
                let parts: Vec<TypeId> = self.parts(receiver).to_vec();
                let mut holder = Atom::NONE;
                for part in parts {
                    let apparent = self.apparent_type(part);
                    // What a function has besides its own properties is declared by the interfaces for functions.
                    let is_function = !self.signatures(part, false).is_empty() || !self.signatures(part, true).is_empty();
                    let of_functions = [crate::atom::known::CallableFunction, crate::atom::known::NewableFunction, crate::atom::known::Function].map(|name| self.global_ref(name, &[]));
                    let declared = [apparent].into_iter().chain(of_functions.into_iter().filter(|_| is_function)).find_map(|holding| {
                        self.members(holding).and_then(|members| match members.resolved.prop(name)?.source {
                            crate::types::PropSource::Symbol(declared) => Some(declared),
                            _ => None,
                        })
                    });
                    match declared.filter(|declared| self.files.module(declared.file).is_lib).and_then(|declared| self.holder_of(declared)) {
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

    fn place_of_argument(&mut self, file: FileId, call_expr: ExprId, call: CallId, e: ExprId) -> Entered {
        let hir = self.hir(file);
        if matches!(hir[e].kind, ExprKind::Spread(_)) {
            return Entered::Nowhere;
        }
        let Some(signature) = self.resolved_signature(file, call_expr).sig else { return Entered::Untyped };
        match self.kind_of_callee(file, hir[call].callee, signature) {
            CalleeKind::Unknown => Entered::Untyped,
            CalleeKind::Typed => {
                self.note_type_arguments_of_call(signature);
                self.note_argument_entering_declared_parameter(file, call, e, signature);
                match self.declared_contextual_type(file, e) {
                    Some(target) => Entered::Typed(target),
                    None => Entered::Untyped,
                }
            }
            CalleeKind::BuiltIn(holder, name) => {
                let index = hir.ids(hir[call].args).position(|argument| argument == e).unwrap_or(usize::MAX);
                let is_constructed = matches!(hir[call_expr].kind, ExprKind::New(_));
                let used = self.uses_by_built_in(file, call, holder, name, is_constructed).map_or(uses::EVERYTHING, |found| found.1.get(index).copied().unwrap_or(uses::EVERYTHING));
                self.entry_of_builtin_operand(file, call_expr, call, e, used)
            }
        }
    }

    /// The contextual type of an argument has what is inferred put in for the type parameters. The parameter as it is declared may be of one.
    fn note_argument_entering_declared_parameter(&mut self, file: FileId, call: CallId, e: ExprId, signature: SigId) {
        let hir = self.hir(file);
        let Some((declared_in, function, _)) = self.sig_decl(signature) else { return };
        let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
        let Some(index) = arguments.iter().position(|&argument| argument == e) else { return };
        if arguments[..index].iter().any(|&argument| matches!(hir[argument].kind, ExprKind::Spread(_))) {
            return;
        }
        let Some(parameter) = self.hir(declared_in)[function].params.iter().nth(index) else { return };
        let (own, declared) = (self.type_of_expr(file, e), self.type_of_param(declared_in, parameter));
        self.note_entering_type_parameters(own, declared);
        if matches!(self.data(declared), TypeData::TypeParam(..)) && self.is_predicted(file, e) {
            let bound = self.base_constraint(declared);
            let mut views: Vec<TypeId> = Vec::new();
            for part in self.parts(bound).to_vec() {
                if self.says_properties(part) {
                    views.push(self.laid_out_as(part));
                }
            }
            self.admits_foreign(own, &views);
        }
    }

    /// What is put in for the type parameters of the function that is called.
    fn note_type_arguments_of_call(&mut self, signature: SigId) {
        let Some((.., mapper)) = self.sig_decl(signature) else { return };
        if mapper == MapperId::IDENTITY || !self.aot.escape_closure.bound_at_calls.insert(signature) {
            return;
        }
        let pairs: Vec<(TypeId, TypeId)> = self.types().mapping(mapper).iter().map(|pair| (pair.0, pair.1)).collect();
        for (parameter, argument) in pairs {
            self.note_entering_type_parameters(argument, parameter);
        }
    }

    /// The name of the holder in `BUILTIN_ENTRIES`, and whether it is the static side.
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
        (holder_named(text).unwrap_or("?"), is_static)
    }

    /// What the built-in may do with its receiver and with each argument of the call: `uses`. The first entry whose patterns fit, as the
    /// engine has it. If none is seen to fit, all of them together, which holds whichever applies. `None`: the table has no entry.
    fn uses_by_built_in(&mut self, file: FileId, call: CallId, holder: Atom, name: Atom, is_constructed: bool) -> Option<(u16, Rc<[u16]>)> {
        if let Some(known) = self.aot.escape_closure.uses.get(&call) {
            return known.clone();
        }
        let found = self.uses_by_built_in_uncached(file, call, holder, name, is_constructed).map(|(this, of_arguments)| (this, Rc::from(of_arguments)));
        self.aot.escape_closure.uses.insert(call, found.clone());
        found
    }

    fn uses_by_built_in_uncached(&mut self, file: FileId, call: CallId, holder: Atom, name: Atom, is_constructed: bool) -> Option<(u16, Vec<u16>)> {
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
                    // Not seen to fit. That leads on to the entries behind it, which hold for any argument that this one holds for.
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

    /// Whether the built-in is handed a function, as an argument or as its receiver, that takes what the types say nothing of: the replacer of
    /// `JSON.stringify`, `(function (this: any) { .. }).call(o)`. By the type of the function itself and by the type that `lib.*.d.ts` has for
    /// the parameter.
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
                let signatures: Vec<SigId> = self.signatures(part, false).iter().copied().collect();
                signatures.into_iter().any(|signature| {
                    let parameters = self.sig_params(signature);
                    let this = self.sig_this_type(signature);
                    (0..parameters.len()).filter_map(|index| self.param_type_at(&parameters, index)).chain(this).collect::<Vec<TypeId>>().into_iter().any(|parameter| self.says_nothing_of_objects(parameter))
                })
            })
        })
    }

    /// `e`: the receiver or an argument of a call of a built-in, which may do `used` with it.
    fn entry_of_builtin_operand(&mut self, file: FileId, call_expr: ExprId, call: CallId, e: ExprId, used: u16) -> Entered {
        if used == uses::EVERYTHING {
            return Entered::Untyped;
        }
        if used & uses::HANDS_OVER != 0 && self.has_callback_with_untyped_parameters(file, call) {
            return Entered::Untyped;
        }
        let own = self.type_of_expr(file, e);
        // The result is of the type that `lib.*.d.ts` has for it.
        let is_result_used = !matches!(self.bound(file).expr_parent[call_expr.idx()], Parent::Stmt(stmt) if matches!(self.hir(file)[stmt].kind, StmtKind::Expr(_)));
        if used & uses::RETURNS != 0 && is_result_used {
            let result = self.type_of_expr(file, call_expr);
            self.note_flow(own, result);
        }
        // It is kept or called as the type that `lib.*.d.ts` has for the parameter. What is handed to a callback is handed over as the
        // parameters of that say.
        if used & (uses::KEEPS | uses::CALLS) != 0 && self.hir(file)[call].callee != e && !self.is_receiver_of(file, call, e) {
            return match self.declared_contextual_type(file, e) {
                Some(target) => Entered::Typed(target),
                None => Entered::Untyped,
            };
        }
        Entered::Nowhere
    }

    fn is_receiver_of(&self, file: FileId, call: CallId, e: ExprId) -> bool {
        let hir = self.hir(file);
        matches!(hir[hir[call].callee].kind, ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == e)
    }

    /// `e`: the object of `access`, a property access. Where it goes if that is what a call calls.
    fn place_of_receiver(&mut self, file: FileId, e: ExprId, access: ExprId) -> Entered {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Expr(call_expr) = bound.expr_parent[access.idx()] else { return Entered::Nowhere };
        let (ExprKind::Call(call) | ExprKind::TaggedTemplate(call)) = hir[call_expr].kind else { return Entered::Nowhere };
        if hir[call].callee != access {
            return Entered::Nowhere;
        }
        // Handed over as `this`.
        let Some(signature) = self.resolved_signature(file, call_expr).sig else { return Entered::Untyped };
        match self.kind_of_callee(file, access, signature) {
            CalleeKind::Unknown => Entered::Untyped,
            // A method is typed code. What is in a field: C4.
            CalleeKind::Typed => Entered::Nowhere,
            CalleeKind::BuiltIn(holder, name) => {
                let used = self.uses_by_built_in(file, call, holder, name, false).map_or(uses::EVERYTHING, |found| found.0);
                self.entry_of_builtin_operand(file, call_expr, call, e, used)
            }
        }
    }

    /// Whether what is stored to `target` can be got at by code that is not compiled with types: a property of the global object, an
    /// ambient variable, a property of an object that a declaration without a body or JavaScript stands for.
    fn is_place_of_untyped_code(&mut self, file: FileId, target: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[target].kind {
            ExprKind::Ident(_) => self.unvouched_claim(file, target).is_some(),
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

    /// Whether the property that `access` names is one that JavaScript declares.
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

    /// The name that the key is, if its type is one string.
    pub(super) fn name_of_key(&mut self, file: FileId, key: ExprId) -> Atom {
        let ty = self.type_of_expr(file, key);
        match *self.data(ty) {
            TypeData::StringLit { value, .. } => value,
            _ => Atom::NONE,
        }
    }
}
