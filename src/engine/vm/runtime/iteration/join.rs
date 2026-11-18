use core::cell::{Cell, RefCell};

use bun_engine_text::names;

use crate::heap::ATOM_SIZE;
use crate::{
    Cx, FastHashSet, Gc, ImmutableArray, JsArray, JsObject, JsResult, JsString, RealmWatchpoint,
    Value, Vm,
};

/// The addresses of the objects whose elements are being joined, which the stack keeps alive.
#[derive(Default)]
pub(super) struct InProgress {
    outermost: Cell<usize>,
    others: RefCell<FastHashSet<usize>>,
}

impl JsObject {
    /// An object that contains itself is the empty string the second time.
    #[inline(always)]
    pub fn unless_being_joined(
        &self,
        cx: &mut Cx,
        join: impl FnOnce(&mut Cx) -> JsResult<Gc<JsString>>,
    ) -> JsResult<Gc<JsString>> {
        cx.check_stack()?;
        let (address, state) = (self.address(), &cx.services.iteration.being_joined);
        let outermost = state.outermost.get();
        if outermost == 0 {
            state.outermost.set(address);
        } else if outermost == address || !state.others.borrow_mut().insert(address) {
            return Ok(cx.small_strings.empty());
        }
        let result = join(cx);
        let state = &cx.services.iteration.being_joined;
        if outermost == 0 {
            state.outermost.set(0);
        } else {
            state.others.borrow_mut().remove(&address);
        }
        result
    }
}

const CACHE_SIZE: usize = 32;

/// The addresses of shared elements and of what they join to. They are forgotten at each collection.
#[derive(Default)]
pub(super) struct Cache([Cell<(usize, usize)>; CACHE_SIZE]);

impl Cache {
    pub(super) fn clear(&self) {
        self.0.iter().for_each(|entry| entry.set((0, 0)));
    }

    fn entry(&self, elements: Gc<ImmutableArray>) -> &Cell<(usize, usize)> {
        &self.0[elements.address() / ATOM_SIZE % CACHE_SIZE]
    }
}

impl JsArray {
    /// Whether `Array.prototype.toString` comes down to `join_with_commas`.
    #[inline]
    pub fn has_default_join(&self, vm: &Vm) -> bool {
        self.realm().is_some_and(|global| {
            self.inherits_from_array_prototype(&global, names::join)
                && global.holds(vm, RealmWatchpoint::ArrayJoin)
        })
    }

    /// `Array.prototype.join` without arguments.
    pub fn join_with_commas(&self, cx: &mut Cx) -> JsResult<Gc<JsString>> {
        let shared = self.shared_elements();
        if let Some(shared) = shared
            && let (key, string) = cx.services.iteration.joined.entry(shared).get()
            && key == shared.address()
        {
            // SAFETY: made since the last collection.
            return Ok(unsafe { Gc::from_address(string) });
        }
        self.unless_being_joined(cx, |cx| {
            let comma = cx.small_strings.single_character(b',');
            let string = self.join_elements(cx, self.length().into(), comma)?;
            if let Some(shared) = shared.filter(|it| it.iter().all(Value::is_primitive)) {
                let entry = cx.services.iteration.joined.entry(shared);
                entry.set((shared.address(), string.address()));
            }
            Ok(string)
        })
    }
}
