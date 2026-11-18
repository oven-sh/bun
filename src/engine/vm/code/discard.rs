//! Gives up code that can be made again, on request.

use std::rc::Rc;

use bun_engine_bytecode::{FunctionRef, Specialization};

use super::lease::SPECIALIZATIONS;
use crate::heap::{RootMap, Scope};
use crate::{
    CodeBlock, Coroutine, FastHashSet, FunctionExecutable, Gc, ModuleExecutable, ScriptExecutable,
    Vm, root_vec,
};

impl Vm {
    /// `visit` does not allocate.
    pub fn for_each_code_block(&self, mut visit: impl FnMut(Gc<CodeBlock>)) {
        (self.heap).for_each_live_destructible_cell(|cell| {
            cell.downcast().into_iter().for_each(&mut visit);
        });
    }

    /// No script is running. What is suspended goes on in the code that it has.
    fn discard_linked_code(&self) {
        let (mut executables, mut coroutines, mut optimized) = (root_vec(), root_vec(), root_vec());
        self.heap.for_each_live_cell(|cell| {
            executables.extend(cell.downcast::<ScriptExecutable>());
            coroutines.extend(cell.downcast::<Coroutine>().filter(|it| it.is_suspended()));
            optimized.extend(cell.downcast::<CodeBlock>().filter(|it| it.is_optimized()));
        });
        optimized.iter().for_each(|it| it.jettison(self));
        let (mut heirs, mut suspended_modules) = (RootMap::default(), FastHashSet::default());
        for coroutine in coroutines {
            let executable = coroutine.executable();
            if let Some(function) = executable.downcast::<FunctionExecutable>() {
                let heir = heirs.entry(function.address());
                coroutine.set_executable(*heir.or_insert_with(|| function.hand_on_code(self)));
            } else {
                suspended_modules.insert(executable.address());
            }
        }
        for executable in executables {
            if suspended_modules.contains(&executable.address()) {
                executable.forget_evals();
                continue;
            }
            for specialization in SPECIALIZATIONS {
                executable.unlink(self, specialization);
            }
            if let Some(module) = executable.downcast::<ModuleExecutable>()
                && !self.keeps_loaded_code()
            {
                module.discard_unit_unless_needed();
            }
        }
    }

    /// As soon as no script is running.
    pub fn discard_all_code(&self) {
        self.when_idle(|vm| {
            vm.clear_code_cache();
            vm.delete_regexp_code();
            vm.discard_linked_code();
            vm.discard_all_bytecode();
        });
    }

    /// As soon as no script is running.
    pub fn shrink_footprint(&self) {
        self.when_idle(|vm| {
            vm.clear_last_exception();
            vm.discard_all_code();
            vm.clear_source_caches();
            vm.heap.collect_and_sweep(Some(Scope::Full));
        });
    }
}

impl FunctionExecutable {
    /// To a new executable, which no function has. The code is not optimized.
    fn hand_on_code(&self, vm: &Vm) -> Gc<ScriptExecutable> {
        let (table, index) = self.place_in_table();
        let function = FunctionRef::new(Rc::clone(table), index);
        let heir = FunctionExecutable::create_inside(vm, self, function);
        let code_block = self.code_block(Specialization::Call);
        let code_block = code_block.expect("what a coroutine is suspended in");
        code_block.set_owner(heir.upcast());
        code_block.is_handed_on.set(true);
        let entry = self.entry(Specialization::Call);
        // SAFETY: the two go together.
        unsafe { heir.install(Specialization::Call, entry, Some(code_block)) };
        heir.upcast()
    }
}
