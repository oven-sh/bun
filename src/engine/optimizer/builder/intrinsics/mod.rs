//! Functions of the library that are done in place of a call.

mod collections;
mod concat;
mod constructors;
mod direct;
mod foreign;
mod in_line;
mod math;
mod objects;
mod operands;
mod patterns;
mod text;

use bun_engine_codegen::ir::Value as Ssa;
use bun_engine_vm::direct::intrinsic_of;
use bun_engine_vm::{
    BufferAccessor, Executable, Gc, Intrinsic, JsObject, NativeExecutable, SpeculatedType as T,
};

use super::Builder;
use super::calls::CallSite;
use super::frame::Junction;
use crate::graph::{CallKind, ExitKind};

impl Builder<'_> {
    /// The result, or `None` if the call has to be made. Nothing but checks has been added then.
    pub(super) fn intrinsic(&mut self, callee: Gc<Executable>, site: &CallSite<'_>) -> Option<Ssa> {
        let constant = self.constant_cell::<JsObject>(site.callee);
        let intrinsic = constant.map_or_else(|| callee.intrinsic(), |it| intrinsic_of(&it));
        if intrinsic == Intrinsic::None
            || site.dst.is_none()
            || self.has_exited(ExitKind::ExoticObject)
        {
            return None;
        }
        self.graph.sites[self.origin.0 as usize].intrinsic = intrinsic;
        if site.kind == CallKind::Construct {
            return self.call_form(intrinsic, site);
        }
        match intrinsic {
            Intrinsic::BufferAccessor => {
                let function = callee.downcast::<NativeExecutable>()?.function();
                return self.access_buffer(BufferAccessor::of(function)?, site);
            }
            Intrinsic::Clock => return self.call_clock(site),
            Intrinsic::FfiFunction => return self.call_foreign(site),
            _ => {}
        }
        (self.math_intrinsic(intrinsic, site))
            .or_else(|| self.text_intrinsic(intrinsic, site))
            .or_else(|| self.has_own_intrinsic(intrinsic, site))
            .or_else(|| self.array_intrinsic(intrinsic, site))
            .or_else(|| self.collection_intrinsic(intrinsic, site))
            .or_else(|| self.data_view_intrinsic(intrinsic, site))
            .or_else(|| self.view_intrinsic(intrinsic, site))
            .or_else(|| self.concat_intrinsic(intrinsic, site))
            .or_else(|| self.object_intrinsic(intrinsic, site))
            .or_else(|| self.call_form(intrinsic, site))
    }

    /// What `quickly` gives. If it leaves for the junction, having had no effect, the call is made after all.
    fn quickly_or_by_call(
        &mut self,
        site: &CallSite<'_>,
        quickly: impl FnOnce(&mut Self, &mut Junction) -> Ssa,
    ) -> Ssa {
        let (mut fork, mut slow) = (self.fork_later(), Junction::default());
        let result = quickly(self, &mut slow);
        self.end_way(&mut fork, Some(result));
        if self.resume_if_reached(&fork, &slow) {
            let result = self.call_as_usual(site, self.proven_executable(site.callee));
            self.end_way(&mut fork, result);
        }
        self.end_fork(&fork).expect("one way goes on")
    }

    /// For a value that has just been made.
    pub(super) fn profile_result(&mut self, value: Ssa, metadata: u32) -> Ssa {
        let seen = self.prediction_at(metadata);
        (self.graph).predict(value, if seen.is_empty() { T::HEAP_TOP } else { seen });
        self.note_profile(value, metadata);
        value
    }

    /// What has never been seen may be anything, and is checked like the rest.
    fn all_expected(&self, values: &[Ssa], ty: T) -> bool {
        values
            .iter()
            .all(|&value| ty.contains(self.expected(value)))
    }
}
