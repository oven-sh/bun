//! What a call goes to.

use bun_engine_codegen::ir::Value as Ssa;
use bun_engine_vm::ic::CallProfile;
use bun_engine_vm::{
    Executable, FunctionExecutable, Gc, InternalFunction, JsBoundFunction, JsFunction, JsObject,
    NativeExecutable, RootVec, SpeculatedType as T, call, root_vec,
};
use smallvec::{SmallVec, smallvec};

use super::calls::CallSite;
use super::{Builder, Built};
use crate::graph::{CallKind, ExitKind, Kind, ShapeSet, heaps};

/// A target gets a way of its own if it has had more than one in so many of the calls.
const RARITY: u64 = 16;

const MAX_METHODS: usize = 6;
/// Not a field: a value that the shape of the object has decided on.
pub(super) const HAS_CHOSEN: i32 = 2;

/// A value that is one of some constants, depending on the shape of an object.
#[derive(Clone)]
pub(super) struct Choice {
    pub(super) value: Ssa,
    pub(super) object: Ssa,
    pub(super) ways: SmallVec<[(Ssa, ShapeSet); 4]>,
    pub(super) own_ways: usize,
}

impl Builder<'_> {
    pub(super) fn proven_executable(&self, callee: Ssa) -> Option<Gc<Executable>> {
        if let Some(function) = self.constant_cell::<JsFunction>(callee) {
            return Some(function.executable());
        }
        if self.constant_cell::<InternalFunction>(callee).is_some() {
            return Some(self.vm.internal_function_executable());
        }
        let root = self.graph.root(callee);
        (self.graph.kind(root) == Some(Kind::NewFunction))
            .then(|| self.constant_cell::<FunctionExecutable>(self.graph.operand(root, 1)))?
            .map(Gc::upcast)
    }

    /// Checks that the callee is what has been called so far, if that is one thing.
    pub(super) fn only_executable(
        &mut self,
        callee: &mut Ssa,
        profile: &CallProfile,
    ) -> Option<Gc<Executable>> {
        let only_callee = profile.callee().get();
        if let Some(function) = only_callee.filter(|_| !self.has_exited(ExitKind::BadIdentity)) {
            let expected = self.cell(function);
            self.check_identical(*callee, expected);
            *callee = expected;
            return self.proven_executable(expected);
        }
        let executable =
            (profile.executable().get()).and_then(Gc::downcast::<FunctionExecutable>)?;
        if self.has_exited(ExitKind::BadExecutable) || self.has_exited(ExitKind::BadType) {
            return None;
        }
        let operands = [
            self.check_type(*callee, T::FUNCTION),
            self.cell(executable.cell()),
        ];
        *callee = self.node(Kind::CheckExecutable, &operands, 0);
        (self.knowledge).learn_type(&self.graph, *callee, T::FUNCTION, *callee);
        Some(executable.upcast())
    }

    /// Its address and its realm, if there is nothing between the call and the function.
    pub(super) fn native_function(&mut self, site: &CallSite<'_>) -> Option<[Ssa; 2]> {
        let specialization = site.kind.specialization();
        let entry = self.proven_executable(site.callee)?.entry(specialization);
        let (function, realm) = match self.constant_cell::<JsFunction>(site.callee) {
            Some(callee) => {
                let native = callee.executable().downcast::<NativeExecutable>()?;
                let function = if entry == call::native_call_entry() {
                    native.function()
                } else if entry == call::native_construct_entry() {
                    native.constructor()
                } else {
                    return None;
                };
                (function, callee.function_realm())
            }
            None => {
                let callee = self.constant_cell::<InternalFunction>(site.callee)?;
                let usual = [
                    call::internal_function_call_entry(),
                    call::internal_function_construct_entry(),
                ];
                let function = callee.native_function(specialization);
                (
                    function.filter(|_| usual.contains(&entry))?,
                    callee.global(),
                )
            }
        };
        Some([self.word(function as usize), self.cell(realm.cell())])
    }

    /// What a bound function passes the call on to, and what with.
    pub(super) fn unbind(&mut self, site: &CallSite<'_>) -> Option<(Ssa, SmallVec<[Ssa; 8]>)> {
        const LONGEST_CHAIN: usize = 4;
        let bound = self.constant_cell::<JsBoundFunction>(site.callee)?;
        let (&first, rest) = site.arguments.split_first()?;
        let mut chain = core::iter::successors(Some(bound), |it| it.target_function().downcast());
        if !bound.forwards(site.kind.specialization(), site.arguments.len())
            || chain.nth(LONGEST_CHAIN).is_some()
        {
            return None;
        }
        let target = self.cell(bound.target_function().cell());
        let first = if site.kind != CallKind::Construct {
            self.value(bound.bound_this())
        } else if self.constant_cell::<JsObject>(first)?.is_same(&bound) {
            target
        } else {
            first
        };
        let mut arguments = smallvec![first];
        bound.for_each_argument(|it| arguments.push(self.value(it)));
        arguments.extend_from_slice(rest);
        Some((target, arguments))
    }

    /// Those that can be inlined, the most frequent first, and whether there have been no others.
    fn targets_to_inline(
        &self,
        site: &CallSite<'_>,
        profile: &CallProfile,
    ) -> (RootVec<Gc<FunctionExecutable>>, bool) {
        let seen = || profile.targets().iter().filter(|it| it.count.get() != 0);
        let total: u64 = seen().map(|it| u64::from(it.count.get())).sum();
        let mut found = root_vec();
        for entry in seen().filter(|it| u64::from(it.count.get()) * RARITY > total) {
            let script = entry.target.get().and_then(Gc::downcast);
            let script = script.filter(|&it| self.inlinable_code(it, site).is_some());
            found.extend(script.map(|script| (entry.count.get(), script)));
        }
        found.sort_by_key(|&(count, _)| core::cmp::Reverse(count));
        let is_complete = found.len() == seen().count()
            && profile.executable().bits() == CallProfile::POLYMORPHIC;
        let mut targets = root_vec();
        targets.extend(found.iter().map(|it| it.1));
        (targets, is_complete)
    }

    pub(super) fn call_one_of_several(
        &mut self,
        site: &CallSite<'_>,
        profile: &CallProfile,
    ) -> Built<Option<Ssa>> {
        let (targets, is_complete) = self.targets_to_inline(site, profile);
        if targets.is_empty()
            || !self.is_full()
            || self.has_exited(ExitKind::BadType)
            || !T::FUNCTION.contains(self.expected(site.callee))
        {
            return self.call_executable(site, None);
        }
        let callee = self.check_type(site.callee, T::FUNCTION);
        let executable = self.node(Kind::LoadExecutable, &[callee], 0);
        let mut fork = self.fork();
        for &target in &targets {
            let expected = self.cell(target.cell());
            let is_it = self.ir().equal(executable, expected);
            let function = &mut self.graph.function;
            let (found, other) = (function.new_block(), function.new_block());
            self.ir().branch(is_it, found, other);
            self.take_way(&fork, found);
            let callee = self.tie_down(callee);
            let site = CallSite { callee, ..*site };
            let result = self.call_executable(&site, Some(target.upcast()))?;
            self.end_way(&mut fork, result);
            self.take_way(&fork, other);
        }
        if is_complete && !self.has_exited(ExitKind::BadExecutable) {
            self.force_exit(ExitKind::BadExecutable);
        } else {
            let result = self.call_executable(&CallSite { callee, ..*site }, None)?;
            self.end_way(&mut fork, result);
        }
        Ok(self.end_fork(&fork))
    }

    /// If the callee depends on the shape of an object, and it is worth knowing for some of them.
    fn is_worth_knowing(&self, site: &CallSite<'_>, callee: Ssa) -> bool {
        self.proven_executable(callee).is_some_and(|executable| {
            match executable.downcast::<FunctionExecutable>() {
                Some(script) => self.inlinable_code(script, site).is_some(),
                None => true,
            }
        })
    }

    /// With those that get a way of their own first.
    pub(super) fn methods_to_tell_apart(&self, site: &CallSite<'_>) -> Option<Choice> {
        let callee = self.graph.root(site.callee);
        let mut choice = self.choices.iter().find(|it| it.value == callee)?.clone();
        let is_worth_it = |way: &(Ssa, ShapeSet)| self.is_worth_knowing(site, way.0);
        choice.ways.sort_by_key(|way| !is_worth_it(way));
        choice.own_ways = choice.ways.iter().filter(|way| is_worth_it(way)).count();
        (self.is_full() && choice.own_ways != 0 && choice.ways.len() <= MAX_METHODS)
            .then_some(choice)
    }

    pub(super) fn call_method(
        &mut self,
        site: &CallSite<'_>,
        choice: &Choice,
    ) -> Built<Option<Ssa>> {
        let has_same_shape =
            (self.knowledge).has_field(choice.object, HAS_CHOSEN, heaps::SHAPE, choice.value);
        let (mut fork, last) = (self.fork(), choice.ways.len() - 1);
        for (position, &(callee, shapes)) in choice.ways.iter().enumerate() {
            if position >= choice.own_ways && position != last {
                let result = self.call_executable(site, None)?;
                self.end_way(&mut fork, result);
                break;
            }
            let other = (position != last).then(|| {
                let is_it = self.ir().equal(choice.value, callee);
                let function = &mut self.graph.function;
                let (found, other) = (function.new_block(), function.new_block());
                self.ir().branch(is_it, found, other);
                self.take_way(&fork, found);
                other
            });
            if has_same_shape {
                self.refine_shapes(choice.object, shapes);
            }
            let executable = self.proven_executable(callee);
            let result = self.call_executable(&CallSite { callee, ..*site }, executable)?;
            self.end_way(&mut fork, result);
            other.inspect(|&other| self.take_way(&fork, other));
        }
        Ok(self.end_fork(&fork))
    }
}
