//! Constructors of the library.

use bun_engine_codegen::ir::Value as Ssa;
use bun_engine_vm::{
    ElementKind, ElementType, Gc, JsMap, MapKind, OrderedCollection, RealmSlot, SetKind, Shape,
    SpeculatedType as T, TableKind,
};

use crate::builder::Builder;
use crate::builder::calls::CallSite;
use crate::graph::{CallKind, Kind, heaps};

const MAX_ELEMENTS: usize = 16;

impl Builder<'_> {
    /// The result, or `None` if the call has to be made. Nothing has been added then.
    pub(in crate::builder) fn construct_in_place(&mut self, site: &CallSite<'_>) -> Option<Ssa> {
        let (global, callee) = (self.global(), self.constant_value(site.callee)?);
        let (&new_target, arguments) = site.arguments.split_first()?;
        let is = |slot| global.slot_if_initialized(slot).map(Into::into) == Some(callee);
        let constructs = site.kind == CallKind::Construct;
        if site.dst.is_none() || constructs && self.constant_value(new_target) != Some(callee) {
            return None;
        }
        if is(RealmSlot::array_constructor) && (2..=MAX_ELEMENTS).contains(&arguments.len()) {
            let kind = self.kind_for(ElementKind::Int32, arguments);
            return Some(self.array_of(kind, arguments, 0));
        }
        if !constructs {
            return None;
        }
        if let Some(of) = global.element_type_constructed_by(callee) {
            return self.new_typed_array(of, *arguments.first()?);
        }
        if !arguments.first().is_none_or(|&it| self.is(it, T::NULLISH)) {
            return None;
        }
        if is(RealmSlot::map_constructor) {
            Some(self.new_collection::<MapKind>(global.map_shape(self.vm)))
        } else if is(RealmSlot::set_constructor) {
            Some(self.new_collection::<SetKind>(global.set_shape(self.vm)))
        } else {
            None
        }
    }

    fn new_collection<K: TableKind>(&mut self, shape: Gc<Shape>) -> Ssa {
        let allocation = self.allocation(shape, size_of::<JsMap>()).expect("small");
        let table = self.cell(K::empty_table(self.vm).upcast());
        let collection = self.made_with_shape(Kind::NewInstance, &[], allocation);
        let offset = OrderedCollection::<K>::OFFSET_OF_TABLE as i32;
        self.initialize(collection, offset, heaps::COLLECTIONS, table);
        collection
    }

    fn new_typed_array(&mut self, of: ElementType, length: Ssa) -> Option<Ssa> {
        let shape = self.global().typed_array_shape(self.vm, of, false);
        (!self.expected(length).intersects(!T::BOXED_NUMBER) && self.may_be_length(length))
            .then(|| self.typed_array_of_zeros(shape, length))
    }
}
