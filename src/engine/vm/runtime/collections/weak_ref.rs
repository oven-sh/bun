use core::sync::atomic::{AtomicU64, Ordering};

use bun_engine_macros::cell;

use crate::{Gc, JsCell, JsObject, JsObjectInit, Shape, Trace, Visitor, Vm, WeakField};

#[cell(name = "WeakRef", visit_children)]
pub struct JsWeakRef {
    base: JsObject,
    /// The target is kept alive until that job ends.
    last_used_in_job: AtomicU64,
    pub(self) target: WeakField<Option<Gc<JsCell>>>,
}

impl JsWeakRef {
    pub fn create_with_shape(vm: &Vm, shape: Gc<Shape>, target: Gc<JsCell>) -> Gc<JsWeakRef> {
        target.will_be_held_weakly();
        vm.allocate::<JsWeakRef>(JsWeakRefInit {
            base: JsObjectInit::new(vm, shape),
            last_used_in_job: AtomicU64::new(vm.current_job()),
            target: Some(target),
        })
    }

    /// WeakRefDeref
    #[inline]
    pub fn deref_target(&self, vm: &Vm) -> Option<Gc<JsCell>> {
        let target = self.target()?;
        if self.last_used_in_job.load(Ordering::Relaxed) != vm.current_job() {
            self.last_used_in_job
                .store(vm.current_job(), Ordering::Relaxed);
            self.write_barrier_for_cell();
        }
        Some(target)
    }

    fn visit_children(&self, visitor: &mut Visitor) {
        if self.last_used_in_job.load(Ordering::Relaxed) == self.heap().vm().current_job() {
            self.target().trace(visitor);
        }
    }
}

impl Vm {
    #[inline(always)]
    fn current_job(&self) -> u64 {
        self.services.collections.job.load(Ordering::Relaxed)
    }

    /// ClearKeptObjects
    #[inline]
    pub fn clear_kept_objects(&self) {
        let next = self.current_job() + 1;
        self.services.collections.job.store(next, Ordering::Relaxed);
    }
}
