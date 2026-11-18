//! Access by key for compiled code that counts on no script being run.

use bun_engine_number::NumberText;
use bun_engine_text::{Identifier, PropertyName, names};

use crate::{
    Attributes, CellKind, CellType, ClonedArguments, ElementKind, JsArray, JsObject, JsTypedArray,
    MappedArguments, TypeFlags, Value, Vm,
};

impl JsObject {
    fn overrides_lookup(&self) -> bool {
        (self.inline_flags()).contains(TypeFlags::OVERRIDES_GET_OWN_PROPERTY_SLOT)
    }

    /// The value of the property that is found along the prototype chain, if there is one. `None` if it takes more to
    /// find out than looking. Allocates nothing in the heap.
    pub fn look_up_int32(&self, vm: &Vm, key: i32) -> Option<Option<Value>> {
        let Ok(index) = u32::try_from(key) else {
            return match key {
                -1 if self.shape().rules_out(names::minusOne) && self.inherits_as_arrays_do() => {
                    Some(None)
                }
                -1 => self.look_up_name(names::minusOne),
                _ => {
                    let name = Identifier::new(NumberText::from(f64::from(key)).text());
                    self.look_up_name(name.name())
                }
            };
        };
        if let Some(sparse) = self.sparse_elements()
            && self.has_ordinary_store_by_index()
        {
            match sparse.get(index) {
                Some(entry) if entry.attributes.contains(Attributes::ACCESSOR) => return None,
                Some(entry) => return Some(Some(entry.value)),
                None if self.inherits_as_arrays_do() => return Some(None),
                None => {}
            }
        } else if self.has_only_own_elements(vm) {
            return Some(self.try_get_dense(index));
        }
        for object in self.chain_direct() {
            if let Some(arguments) = object.downcast::<MappedArguments>() {
                if let Some(value) = arguments.try_get(index) {
                    return Some(Some(value));
                }
                if arguments.indexing_mode().has_elements() {
                    return None;
                }
            } else if object.overrides_lookup() && !object.class().has_ordinary_lookup_by_index() {
                return None;
            } else if let Some(entry) = object.own_element(index) {
                let is_plain = !entry.attributes.contains(Attributes::ACCESSOR);
                return is_plain.then_some(Some(entry.value));
            }
            if object.overrides_get_prototype() {
                return None;
            }
        }
        Some(None)
    }

    /// The same for a name that is no index.
    #[inline]
    pub fn look_up_name(&self, name: PropertyName<'_>) -> Option<Option<Value>> {
        for object in self.chain_direct() {
            let shape = object.shape();
            if object.overrides_lookup() && !shape.is_ordinary_name(name) {
                return None;
            }
            if let Some((value, attributes)) = object.get_direct_with_attributes(name) {
                let is_plain = !attributes.intersects(Attributes::ANY_ACCESSOR);
                return is_plain.then_some(Some(value));
            }
            if object.overrides_get_prototype()
                || shape.has_non_reified_static_properties()
                    && shape.find_static_property(name).is_some()
            {
                return None;
            }
        }
        Some(None)
    }

    pub(crate) fn try_has_own_index(&self, index: u32) -> Option<bool> {
        if let Some(array) = self.downcast::<JsTypedArray>() {
            return (!array.is_resizable_or_growable())
                .then(|| array.is_valid_index(index as usize));
        }
        if (self.downcast::<MappedArguments>()).is_some_and(|it| index < it.plain_length()) {
            return Some(true);
        }
        (!self.overrides_lookup() || self.class().has_ordinary_lookup_by_index())
            .then(|| self.own_element(index).is_some())
    }

    /// LengthOfArrayLike, if that takes no more than a look.
    pub fn try_length_of_array_like(&self) -> Option<u32> {
        if let Some(array) = self.as_exact_array() {
            return Some(array.length());
        }
        match self.downcast::<MappedArguments>() {
            Some(arguments) => arguments.original_length(),
            None => self.downcast::<ClonedArguments>()?.try_length(),
        }
    }

    /// If both `[[Set]]` and CreateDataProperty come down to that. Otherwise no script can tell that it has been tried.
    pub fn try_store_plain_element(&self, vm: &Vm, index: u32, value: Value) -> bool {
        let class = self.class();
        if self.cell_type() != CellType::FinalObject
            && !class.is(JsArray::CLASS)
            && !(class.has_ordinary_put_by_index() && class.has_ordinary_define_own_property())
        {
            return false;
        }
        if !self.has_unrestricted_elements() {
            let may_store = match self.own_element(index) {
                Some(entry) => entry.attributes.is_empty(),
                None => {
                    !self.chain_may_intercept_indexed_access()
                        && self.shape().is_extensible()
                        && !self.length_forbids(index)
                }
            };
            if !may_store {
                return false;
            }
        }
        match self.sparse_elements().filter(|it| it.get(index).is_some()) {
            Some(sparse) => {
                sparse.insert(index, value, Attributes::NONE);
                self.convert_to_dense_if_worthwhile(vm, &sparse);
                true
            }
            None => self.store_element(vm, index, value).is_ok(),
        }
    }
}

/// If these fail, no script can tell that they have been tried.
impl JsArray {
    pub fn try_pop(&self, vm: &Vm) -> Option<Value> {
        if !self.has_unrestricted_elements() {
            return None;
        }
        let Some(last) = self.length().checked_sub(1) else {
            return Some(Value::UNDEFINED);
        };
        let value = self.try_get_dense(last)?;
        self.try_ensure_writable_elements(vm).ok()?;
        // SAFETY: there is an element at that index.
        unsafe {
            (self.storage()).clear_elements(self.element_kind(), last, last + 1);
            self.storage().set_public_length(last);
        }
        Some(value)
    }

    /// The range is inside.
    pub fn try_replace_range(&self, vm: &Vm, start: u32, removed: u32, items: &[Value]) -> bool {
        // What can fail after the elements have moved comes first.
        let kind = ElementKind::Undecided.generalized_for_slice(items);
        let [length, start, removed] = [self.length(), start, removed].map(u64::from);
        self.has_unrestricted_elements()
            && (items.is_empty() || self.ensure_element_kind(vm, kind).is_ok())
            && (self.try_splice(vm, length, start, removed, items)).is_ok_and(|is_done| is_done)
    }
}
