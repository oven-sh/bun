use core::marker::PhantomData;
use core::ops::Deref;

use bun_engine_vm::heap::Heap;
use bun_engine_vm::{Cx, JsObject, Vm};

/// What a `&mut Cx` allows, for one who is in no realm.
pub struct AnyRealm<'a>(&'a Vm, PhantomData<&'a mut Cx>);

impl<'a> AnyRealm<'a> {
    /// # Safety
    /// As for `Cx::from_global`, to get a `&mut Cx`.
    pub unsafe fn assume(vm: &'a Vm) -> AnyRealm<'a> {
        AnyRealm(vm, PhantomData)
    }

    pub(crate) fn heap(&self) -> &'a Heap {
        &self.0.heap
    }

    pub(crate) fn realm_of(&mut self, object: &JsObject) -> Option<&mut Cx> {
        // SAFETY: borrows `self`, which stands for such a borrow.
        Some(unsafe { Cx::from_global(object.realm()?) })
    }
}

impl<'a> From<&'a mut Cx> for AnyRealm<'a> {
    fn from(cx: &'a mut Cx) -> AnyRealm<'a> {
        AnyRealm(cx.vm(), PhantomData)
    }
}

impl Deref for AnyRealm<'_> {
    type Target = Vm;

    fn deref(&self) -> &Vm {
        self.0
    }
}
