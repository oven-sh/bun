//! The state that the parts of the run time keep in the `Vm`.

use crate::heap::{Scope, Survivors};
use crate::{Visitor, Vm, caches, code, error, runtime};

pub(crate) trait Service {
    fn initialize(&self, _: &Vm) {}

    /// From outside of any script.
    fn will_enter(&self, _: &Vm) {}

    fn visit(&self, _: &mut Visitor) {}

    /// Again and again, until it marks nothing new.
    fn visit_output_constraints(&self, _: &mut Visitor) {}

    fn reconcile_weak_references(&self, _: &Vm, _: &Survivors) {}

    fn did_collect(&self, _: &Vm, _: Scope) {}

    fn will_destroy(&self, _: &Vm) {}
}

macro_rules! services {
    ($($name:ident: $type:ty,)*) => {
        #[derive(Default)]
        pub(crate) struct Services {
            $(pub(crate) $name: $type,)*
        }

        impl Service for Services {
            fn initialize(&self, vm: &Vm) {
                $(self.$name.initialize(vm);)*
            }

            #[inline]
            fn will_enter(&self, vm: &Vm) {
                $(self.$name.will_enter(vm);)*
            }

            fn visit(&self, visitor: &mut Visitor) {
                $(self.$name.visit(visitor);)*
            }

            fn visit_output_constraints(&self, visitor: &mut Visitor) {
                $(self.$name.visit_output_constraints(visitor);)*
            }

            fn reconcile_weak_references(&self, vm: &Vm, survivors: &Survivors) {
                $(self.$name.reconcile_weak_references(vm, survivors);)*
            }

            fn did_collect(&self, vm: &Vm, scope: Scope) {
                $(self.$name.did_collect(vm, scope);)*
            }

            fn will_destroy(&self, vm: &Vm) {
                $(self.$name.will_destroy(vm);)*
            }
        }
    };
}

services! {
    bigints: crate::primitive::BigIntState,
    caches: caches::State,
    prototype_lookups: crate::ic::PrototypeLookups,
    code: code::State,
    debugger: crate::debugger::State,
    errors: error::State,
    buffers: runtime::buffers::State,
    collections: runtime::collections::State,
    control: runtime::control::State,
    deferred: runtime::deferred::State,
    iteration: runtime::iteration::State,
    modules: runtime::modules::State,
    text: runtime::text::State,
}
