//! Strings as property keys.

use bun_alloc::AllocError;
use bun_engine_text::{Atom, Identifier, StringRef, Text};

use super::string::impl_at;
use crate::{Cx, Gc, JsResult, JsRopeString, JsString, PropertyKey, RopeBuilder, Vm};

/// Up to here the characters of a rope are looked up before anything is allocated for them.
const MAX_LENGTH_ON_STACK: usize = 256;
const MAX_CACHED_KEY_LENGTH: usize = 64;

impl JsRopeString {
    #[inline(always)]
    fn with_short_text<R>(&self, read: impl FnOnce(Text<'_>) -> R) -> Option<R> {
        if self.rope_length() as usize > MAX_LENGTH_ON_STACK {
            return None;
        }
        Some(match self.try_view() {
            Some(view) => read(view.text()),
            None => {
                JsString::with_copy_on_stack::<MAX_LENGTH_ON_STACK, R>(&[(&**self).into()], read)
            }
        })
    }
}

impl JsString {
    #[inline(always)]
    pub fn to_property_key(&self, cx: &Cx) -> JsResult<PropertyKey> {
        if !self.is_atom() {
            cx.or_out_of_memory(self.atomize(cx))?;
        }
        // SAFETY: an atom, which is never swapped again.
        Ok(unsafe { PropertyKey::from_atom_string(self.into(), impl_at(self.fiber())) })
    }

    pub fn to_identifier(&self, cx: &Cx) -> JsResult<Identifier> {
        Ok(self.to_property_key(cx)?.to_identifier())
    }

    /// `None` if no atom has these characters, so that no ordinary object has such a property.
    #[inline(always)]
    pub fn to_existing_property_key(&self, cx: &Cx) -> JsResult<Option<PropertyKey>> {
        if !self.is_atom() && !cx.or_out_of_memory(self.adopt_existing_atom(cx))? {
            return Ok(None);
        }
        self.to_property_key(cx).map(Some)
    }

    #[inline(never)]
    fn atomize(&self, vm: &Vm) -> Result<(), AllocError> {
        if let Some(rope) = self.as_rope() {
            let atom = match rope.with_short_text(Atom::try_new) {
                Some(atom) => atom?,
                None => Atom::try_from_string(&*rope.characters()?)?,
            };
            rope.become_flat(vm, atom.into_string());
            return Ok(());
        }
        let string = self.try_impl().expect("no rope");
        if string.is_atom() {
            self.set_per_cell_bit(true);
        } else {
            self.swap_to_atom(vm, Atom::try_from_string(string)?);
        }
        Ok(())
    }

    #[inline(never)]
    fn adopt_existing_atom(&self, vm: &Vm) -> Result<bool, AllocError> {
        if let Some(rope) = self.as_rope()
            && let Some(found) = rope.with_short_text(Atom::find)
        {
            return Ok(found
                .map(|atom| self.set_characters(atom.into_string()))
                .is_some());
        }
        let found = Atom::find_string(&*self.try_resolve(vm)?);
        Ok(found.map(|atom| self.swap_to_atom(vm, atom)).is_some())
    }

    /// `self` is no rope.
    fn swap_to_atom(&self, vm: &Vm, atom: Atom) {
        let old = self.fiber();
        if old == atom.address() {
            return self.set_per_cell_bit(true);
        }
        self.set_characters(atom.into_string());
        // SAFETY: the cell held a count of it.
        let old = unsafe { StringRef::from_raw(impl_at(old)) };
        vm.string_caches.retire(self.address(), old);
    }

    /// The concatenation of `parts` as an atom, for a key that is computed again and again.
    pub fn concat_to_atom(cx: &Cx, parts: &[Gc<JsString>]) -> JsResult<Gc<JsString>> {
        let length: usize = parts.iter().map(|part| part.len() as usize).sum();
        if parts.len() > 1 && length <= MAX_CACHED_KEY_LENGTH {
            let look_up = |text: Text<'_>| Self::try_from_text_as_atom(cx, text);
            let atom = Self::with_copy_on_stack::<MAX_CACHED_KEY_LENGTH, _>(parts, look_up);
            return cx.or_out_of_memory(atom);
        }
        let mut builder = RopeBuilder::default();
        for &part in parts {
            builder.push(cx, part)?;
        }
        let string = builder.finish(cx);
        string.to_property_key(cx)?;
        Ok(string)
    }
}
