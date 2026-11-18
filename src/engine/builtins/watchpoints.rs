use bun_engine_text::PropertyName;
use bun_engine_vm::{PropertyCondition, RealmWatchpoint};

use crate::prelude::*;
use crate::{arrays, buffers, collections, control, functions, fundamental, numbers, text};

/// Collects conditions until one does not hold.
pub(crate) struct Conditions<'a> {
    cx: &'a Cx,
    list: Option<Vec<PropertyCondition>>,
}

impl Conditions<'_> {
    pub(crate) fn add(
        &mut self,
        object: &JsObject,
        make: impl FnOnce() -> Option<PropertyCondition>,
    ) {
        object.flatten_dictionary(self.cx);
        let condition = make();
        self.list = self
            .list
            .take()
            .zip(condition)
            .map(|(mut list, condition)| {
                list.push(condition);
                list
            });
    }

    pub(crate) fn no_elements(&mut self, object: &JsObject, prototype: Value) {
        self.add(object, || {
            PropertyCondition::absence_of_elements(object)
                .filter(|_| object.prototype_direct() == prototype)
        });
    }

    /// The property is what the static table of the object says, and stays so.
    pub(crate) fn pristine(&mut self, object: &JsObject, name: PropertyName<'_>) {
        let is_pristine = object.reify_if_pristine(self.cx, name);
        self.add(object, || {
            PropertyCondition::equivalence(object, name).filter(|_| is_pristine)
        });
    }

    pub(crate) fn absent(&mut self, object: &JsObject, name: PropertyName<'_>, prototype: Value) {
        self.add(object, || {
            PropertyCondition::absence(object, name)
                .filter(|_| object.prototype_direct() == prototype)
        });
    }

    /// An object that inherits from `prototype` has the original `next`, is its own iterator and has no `return`.
    pub(crate) fn pristine_iterator(&mut self, prototype: &JsObject) {
        let (iterator, object) = (self.cx.iterator_prototype(), self.cx.object_prototype());
        self.pristine(prototype, names::next);
        self.pristine(&iterator, symbols::iterator);
        self.absent(prototype, symbols::iterator, iterator.into());
        self.absent(prototype, names::r#return, iterator.into());
        self.absent(&iterator, names::r#return, object.into());
        self.absent(&object, names::r#return, Value::NULL);
    }

    /// The object gets them all before its shape is watched.
    pub(crate) fn all_pristine<'a>(
        &mut self,
        object: &JsObject,
        names: impl Iterator<Item = PropertyName<'a>> + Clone,
    ) {
        for name in names.clone() {
            object.reify_if_pristine(self.cx, name);
        }
        names.for_each(|name| self.pristine(object, name));
    }
}

pub fn watchpoint_conditions(cx: &Cx, which: RealmWatchpoint) -> Option<Vec<PropertyCondition>> {
    let mut conditions = Conditions {
        cx,
        list: Some(Vec::new()),
    };
    let is_known = arrays::add_conditions(cx, which, &mut conditions)
        || buffers::add_conditions(cx, which, &mut conditions)
        || collections::add_conditions(cx, which, &mut conditions)
        || control::add_conditions(cx, which, &mut conditions)
        || functions::add_conditions(cx, which, &mut conditions)
        || fundamental::add_conditions(cx, which, &mut conditions)
        || numbers::add_conditions(cx, which, &mut conditions)
        || text::add_conditions(cx, which, &mut conditions);
    conditions.list.filter(|_| is_known)
}
