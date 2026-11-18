//! Finds out where the time goes by looking at the stack at regular intervals.

mod native_symbol;
mod profile;
mod report;
mod resolver;
mod sampler;
mod walker;

use core::cell::{Ref, RefCell};
use std::rc::Rc;
use std::sync::Arc;

use bun_engine_text::{AllocError, StringRef};
use bun_engine_vm::{Visitor, Vm, options};

pub use profile::{Profile, SampledFrame, SampledFrameKind, Trace};

use profile::CallTree;
use sampler::Sampler;

pub struct SamplingProfiler {
    sampler: Arc<Sampler>,
    tree: RefCell<CallTree>,
}

impl Default for SamplingProfiler {
    fn default() -> SamplingProfiler {
        SamplingProfiler {
            sampler: Sampler::new(f64::from(options().sample_interval) / 1e6),
            tree: RefCell::default(),
        }
    }
}

impl SamplingProfiler {
    /// It is paused until it is started.
    fn of(vm: &Vm) -> Rc<SamplingProfiler> {
        vm.records_code_origins().set(true);
        vm.extension()
    }

    /// Whether it has been started or set up.
    pub fn exists(vm: &Vm) -> bool {
        vm.existing_extension::<SamplingProfiler>().is_some()
    }

    pub fn set_interval_microseconds(vm: &Vm, microseconds: f64) {
        Self::of(vm)
            .sampler
            .set_interval_seconds(microseconds / 1e6);
    }

    /// Or goes on after a pause.
    pub fn start(vm: &Vm) {
        // SAFETY: the one of this `Vm`, which `will_destroy` shuts down.
        unsafe { Self::of(vm).sampler.start(vm) }
    }

    /// No sample is taken once this has returned.
    pub fn pause(vm: &Vm) {
        Self::of(vm).sampler.pause();
    }

    /// Drops the samples.
    pub fn clear(vm: &Vm) {
        let this = Self::of(vm);
        this.sampler.take();
        this.tree.take();
    }

    /// Hands the samples over.
    pub fn take_profile(vm: &Vm) -> Profile<'_> {
        let this = Self::of(vm);
        this.resolve(vm);
        Profile::new(vm, this.tree.take())
    }

    /// Keeps the samples.
    pub fn top_functions_report(vm: &Vm) -> StringRef {
        let this = Self::of(vm);
        report::top_functions(&this.resolve(vm), this.sampler.interval_seconds())
    }

    /// Keeps the samples.
    pub fn top_bytecodes_report(vm: &Vm) -> StringRef {
        let this = Self::of(vm);
        report::top_bytecodes(&this.resolve(vm), this.sampler.interval_seconds())
    }

    /// Drops the samples.
    pub fn take_traces_as_json(vm: &Vm) -> Result<StringRef, AllocError> {
        let interval = Self::of(vm).sampler.interval_seconds();
        report::traces_as_json(vm, Self::take_profile(vm).tree(), interval)
    }

    fn resolve(&self, vm: &Vm) -> Ref<'_, CallTree> {
        resolver::resolve(vm, &self.sampler.take(), &mut self.tree.borrow_mut());
        self.tree.borrow()
    }

    pub(super) fn will_mark(&self, vm: &Vm) {
        self.resolve(vm);
    }

    pub(super) fn visit(&self, visitor: &mut Visitor) {
        self.tree.borrow().visit(visitor);
    }

    pub(super) fn shut_down(&self) {
        self.sampler.shut_down();
    }
}
