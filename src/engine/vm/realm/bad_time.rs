//! A prototype that has a say in stores to indices takes the fast path away from the objects that inherit from it.

use crate::{
    CellType, FunctionRareData, GlobalObject, JsObject, RealmWatchpoint, TransitionKind, Vm,
    root_vec,
};

impl JsObject {
    /// In the bit of the cell. The prototypes of one that has it set have it too.
    fn remembers_heirs_with_elements(&self) -> bool {
        matches!(self.cell_type(), CellType::FinalObject | CellType::Function)
    }

    pub(crate) fn may_have_heirs_with_elements(&self) -> bool {
        self.shape().may_be_prototype()
            && (!self.remembers_heirs_with_elements() || self.per_cell_bit())
    }

    pub(crate) fn will_have_heirs_with_elements(&self) {
        (self.chain_direct())
            .filter(|it| it.remembers_heirs_with_elements())
            .take_while(|it| !it.per_cell_bit())
            .for_each(|it| it.set_per_cell_bit(true));
    }

    /// From now on, whatever becomes of its properties and prototypes.
    pub(crate) fn intercept_indexed_access_of_heirs(&self, vm: &Vm) {
        self.non_property_transition(vm, TransitionKind::AddIndexedAccessors);
        if self.may_have_heirs_with_elements() {
            vm.slow_down_heirs_of_interceptors();
        }
    }
}

impl Vm {
    #[cold]
    fn slow_down_heirs_of_interceptors(&self) {
        let _defer = self.heap.defer_collection();
        let (mut objects, mut globals, mut rare_data) = (root_vec(), root_vec(), root_vec());
        self.heap.for_each_live_cell(|cell| {
            if let Some(object) = cell.downcast::<JsObject>() {
                let mode = object.indexing_mode();
                if mode.kind().is_dense()
                    && !mode.is_slow_put()
                    && object.chain_may_intercept_indexed_access()
                {
                    objects.push(object);
                }
                globals.extend(object.downcast::<GlobalObject>());
            } else {
                rare_data.extend(cell.downcast::<FunctionRareData>());
            }
        });
        for global in globals {
            if !global.is_having_a_bad_time()
                && global.is_initialized()
                && [global.array_prototype(), global.object_prototype()]
                    .iter()
                    .any(|it| it.chain_may_intercept_indexed_access())
            {
                global.switch_array_shapes_to_slow_put(self);
                global
                    .watchpoints_unchecked(RealmWatchpoint::NotHavingABadTime)
                    .invalidate(self);
            }
        }
        self.shape_cache.clear();
        for rare_data in rare_data {
            if rare_data
                .subclass_shape()
                .is_some_and(|shape| shape.instance_indexing_mode().has_elements())
            {
                rare_data.clear(self);
            }
        }
        for object in objects {
            object.non_property_transition(self, TransitionKind::SwitchToSlowPut);
        }
    }
}
