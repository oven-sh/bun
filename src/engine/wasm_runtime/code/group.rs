//! All code of a module for one way to access memory. Instances and threads share it.

use core::sync::atomic::{AtomicI32, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock, Weak};

use bun_engine_exec_memory::{synchronize_instructions, synchronize_instructions_of_all_threads};
use bun_engine_macros::native_abi;
use bun_engine_wasm_compiler::abi::{CallProfile, FunctionSlot, MemoryMode, Trap};
use bun_engine_wasm_compiler::optimize::InliningBudget;
use bun_engine_wasm_compiler::{CompiledFunction, Counters, Environment};
use bun_engine_wasm_format::{CodeIndex, OutOfMemory};
use bun_threading::Guarded;

use super::feedback::{Callees, Observed};
use super::installed::Kind;
use super::tiering::{Heat, entry_increment, first_countdown};
use super::{Compilers, InstalledCode, RetiredCode, STACK_FOR_COMPILERS};
use crate::alloc::{try_boxed, try_defaults};
use crate::engine::Tiering;
use crate::instance::Instance;
use crate::module::Module;
use crate::outcome::Outcome;

/// What it takes to compile a larger one is not kept for the next.
const LARGE_FUNCTION_SIZE: u32 = 32 << 10;

pub(crate) struct CodeGroup {
    mode: MemoryMode,
    slots: Box<[FunctionSlot]>,
    /// Made when something is to be said about the function.
    functions: Box<[OnceLock<Box<Function>>]>,
    /// The threads that have instances, and how many.
    users: Guarded<Vec<(Arc<RetiredCode>, usize)>>,
    #[expect(clippy::vec_box, reason = "profiles have their addresses")]
    pub(super) callees: Guarded<Vec<Box<Callees>>>,
    pub(super) inlining_budget: OnceLock<InliningBudget>,
}

pub(super) struct Function {
    pub(super) call_profiles: Box<[CallProfile]>,
    pub(super) loop_countdowns: Box<[AtomicI32]>,
    /// No thread holds the locks of two functions.
    pub(super) state: Guarded<State>,
}

pub(super) struct State {
    /// Until it is replaced.
    baseline: Option<Arc<InstalledCode>>,
    /// Also after that, while it may be on a stack.
    pub(super) lingering_baseline: Weak<InstalledCode>,
    pub(super) optimized: Optimized,
    /// Direct calls of this function that go through the slot.
    waiting_calls: Vec<(Weak<InstalledCode>, u32)>,
    pub(super) heat: Heat,
}

pub(super) enum Optimized {
    NotStarted,
    Started,
    /// It stays as long as the group.
    Done(Arc<InstalledCode>),
    Failed,
}

enum NotCompiled {
    TooLarge,
    NoRoom,
}

impl CodeGroup {
    pub(crate) fn new(module: &Module, mode: MemoryMode) -> Result<Self, OutOfMemory> {
        let engine = module.engine();
        let entry = (engine.stubs_if_any()).map_or(0, |stubs| stubs.compile_lazily);
        let countdown = first_countdown(engine);
        let slot = |_| FunctionSlot {
            entry: AtomicUsize::new(entry),
            countdown: AtomicI32::new(countdown),
        };
        let slots = try_boxed((0..module.code_count()).map(slot))?;
        slots.as_ptr().expose_provenance();
        Ok(Self {
            mode,
            slots,
            functions: try_defaults(module.code_count() as usize)?,
            users: Guarded::default(),
            callees: Guarded::default(),
            inlining_budget: OnceLock::new(),
        })
    }

    #[inline]
    pub(super) fn slot(&self, code: CodeIndex) -> &FunctionSlot {
        &self.slots[code.usize()]
    }

    #[inline]
    pub(crate) fn slot_address(&self, code: CodeIndex) -> usize {
        core::ptr::from_ref(self.slot(code)).addr()
    }

    pub(crate) fn first_slot_address(&self) -> usize {
        self.slots.as_ptr().addr()
    }

    pub(crate) fn code_with_slot(&self, slot: usize) -> Option<CodeIndex> {
        let index = slot.wrapping_sub(self.first_slot_address()) / FunctionSlot::SIZE;
        (index < self.slots.len()).then_some(CodeIndex(index as u32))
    }

    pub(crate) fn add_user(&self, user: &Arc<RetiredCode>) {
        let mut users = self.users.lock();
        match users.iter_mut().find(|known| Arc::ptr_eq(&known.0, user)) {
            Some((_, instances)) => *instances += 1,
            None => {
                users.push((Arc::clone(user), 1));
                // For the code that was installed when there was no other thread to tell.
                synchronize_instructions();
            }
        }
    }

    pub(crate) fn remove_user(&self, user: &Arc<RetiredCode>) {
        let mut users = self.users.lock();
        let position = users.iter().position(|known| Arc::ptr_eq(&known.0, user));
        let position = position.expect("it was added");
        users[position].1 -= 1;
        if users[position].1 == 0 {
            users.swap_remove(position);
        }
    }

    pub(super) fn existing_function(&self, code: CodeIndex) -> Option<&Function> {
        self.functions[code.usize()]
            .get()
            .map(|function| &**function)
    }

    fn function(&self, module: &Module, code: CodeIndex) -> Result<&Function, OutOfMemory> {
        if let Some(function) = self.existing_function(code) {
            return Ok(function);
        }
        let engine = module.engine();
        let (calls, loops) = match engine.options().tiering {
            Tiering::After(_) => (module.facts(code).call_count, module.facts(code).loop_count),
            Tiering::Interpreted | Tiering::BaselineOnly | Tiering::OptimizedOnly => (0, 0),
        };
        let profile = |_| CallProfile {
            slot: AtomicUsize::new(0),
            count: AtomicU32::new(0),
        };
        let countdown = first_countdown(engine);
        let function = Box::new(Function {
            call_profiles: try_boxed((0..calls).map(profile))?,
            loop_countdowns: try_boxed((0..loops).map(|_| AtomicI32::new(countdown)))?,
            state: Guarded::new(State {
                baseline: None,
                lingering_baseline: Weak::new(),
                optimized: Optimized::NotStarted,
                waiting_calls: Vec::new(),
                heat: Heat::new(countdown, loops)?,
            }),
        });
        Ok(self.functions[code.usize()].get_or_init(|| function))
    }

    fn environment<'a>(&self, module: &'a Module, code: CodeIndex) -> Environment<'a> {
        let engine = module.engine();
        Environment {
            module,
            layout: module.layout(),
            host: engine.layout(),
            stubs: &engine.stubs().for_compilers,
            features: engine.options().cpu,
            mode: self.mode,
            slots: self.first_slot_address(),
            seed: engine.options().seed ^ (u64::from(code.0) << 32),
        }
    }

    /// Several threads may do this at once. The code of the first that is done counts.
    fn compile_first(
        &self,
        module: &Module,
        code: CodeIndex,
        compilers: &mut Compilers,
    ) -> Result<(), NotCompiled> {
        let function = (self.function(module, code)).map_err(|OutOfMemory| NotCompiled::NoRoom)?;
        let tiering = module.engine().options().tiering;
        if let Tiering::OptimizedOnly = tiering
            && self.replace_with_optimized(module, code, compilers)
        {
            return Ok(());
        }
        let counters = matches!(tiering, Tiering::After(_)).then(|| Counters {
            call_profiles: function.call_profiles.as_ptr().expose_provenance(),
            loop_countdowns: function.loop_countdowns.as_ptr().expose_provenance(),
            entry_increment: entry_increment(module, code),
        });
        let environment = self.environment(module, code);
        let compiled = compilers
            .baseline
            .compile(&environment, code, counters, None);
        let compiled = compiled.map_err(|_| NotCompiled::TooLarge)?;
        let baseline = InstalledCode::new(module, code, &compiled, Kind::Baseline);
        compilers.baseline.recycle(compiled);
        let baseline = baseline.map_err(|_| NotCompiled::NoRoom)?;
        if cfg!(target_arch = "aarch64") && self.users.lock().len() > 1 {
            synchronize_instructions_of_all_threads();
        }

        let mut state = function.state.lock();
        if state.baseline.is_none() && !matches!(state.optimized, Optimized::Done(_)) {
            self.slot(code)
                .entry
                .store(baseline.entry(), Ordering::Release);
            state.lingering_baseline = Arc::downgrade(&baseline);
            state.baseline = Some(baseline);
        }
        Ok(())
    }

    /// All threads are ready to run what this gives.
    pub(super) fn optimize(
        &self,
        module: &Module,
        code: CodeIndex,
        kind: Kind,
        compilers: &mut Compilers,
    ) -> Option<Arc<InstalledCode>> {
        let loop_entry = match kind {
            Kind::LoopEntry(index) => Some(index),
            Kind::Baseline | Kind::Optimized => None,
        };
        let feedback = Observed {
            module,
            group: self,
        };
        let environment = self.environment(module, code);
        let optimizer = module.engine().options().optimizer;
        let compiled = optimizer(compilers, &environment, code, loop_entry, &feedback)?;
        let installed = InstalledCode::new(module, code, &compiled, kind).ok()?;
        self.link_direct_calls(module, &compiled, &installed);
        synchronize_instructions_of_all_threads();
        Some(installed)
    }

    fn link_direct_calls(
        &self,
        module: &Module,
        compiled: &CompiledFunction,
        caller: &Arc<InstalledCode>,
    ) {
        for call in &compiled.direct_calls {
            let Ok(callee) = self.function(module, call.callee) else {
                continue;
            };
            let mut state = callee.state.lock();
            match &state.optimized {
                // SAFETY: the code was installed, and nobody else knows of the call.
                Optimized::Done(code) => unsafe { caller.point_call_at(call.end_offset, code) },
                Optimized::Failed => {}
                Optimized::NotStarted | Optimized::Started => {
                    let waiting = (Arc::downgrade(caller), call.end_offset);
                    state.waiting_calls.push(waiting);
                }
            }
        }
    }

    /// Gives `false` if there is no optimized code.
    pub(super) fn replace_with_optimized(
        &self,
        module: &Module,
        code: CodeIndex,
        compilers: &mut Compilers,
    ) -> bool {
        let optimized = self.optimize(module, code, Kind::Optimized, compilers);
        let function = self.existing_function(code).expect("it was called");
        let mut state = function.state.lock();
        if let Optimized::Done(_) = state.optimized {
            return true;
        }
        let Some(optimized) = optimized else {
            state.optimized = Optimized::Failed;
            state.waiting_calls = Vec::new();
            return false;
        };
        self.slot(code)
            .entry
            .store(optimized.entry(), Ordering::Release);
        for (caller, end_offset) in core::mem::take(&mut state.waiting_calls) {
            if let Some(caller) = caller.upgrade() {
                // SAFETY: the code stays from now on, and a call waits in one list only.
                unsafe { caller.point_call_at(end_offset, &optimized) };
            }
        }
        state.optimized = Optimized::Done(optimized);
        if let Some(baseline) = state.baseline.take() {
            for (user, _) in &*self.users.lock() {
                user.add(Arc::clone(&baseline));
            }
        }
        true
    }
}

/// # Safety
/// For the stub, with its frame pointer. The slot is that of a function of the instance.
#[native_abi]
pub(crate) unsafe fn compile_lazily(instance: &Instance, slot: usize, fp: usize) -> Outcome {
    let (module, group, store) = (instance.module(), instance.code(), instance.store());
    if store.stack_below(fp) < STACK_FOR_COMPILERS {
        return Outcome::failure(Trap::StackOverflow);
    }
    store.set_top_frame(fp);
    let code = group.code_with_slot(slot).expect("a slot of the group");
    let compile = || group.compile_first(module, code, &mut store.compilers.borrow_mut());
    let is_compiled = match compile() {
        Ok(()) => true,
        Err(NotCompiled::TooLarge) => false,
        Err(NotCompiled::NoRoom) => store.after_making_room_for_code(|| compile().is_ok()),
    };
    if module.body_span(code).len > LARGE_FUNCTION_SIZE {
        store.compilers.take();
    }
    instance.engine().host().module_grew(instance);
    store.collect_if_code_adds_up();
    is_compiled.then_some(()).ok_or(Trap::OutOfMemory).into()
}
