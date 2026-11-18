use core::ptr::NonNull;

use bun_engine_text::{Identifier, PropertyName, StringImpl};

use crate::heap::keep_alive;
use crate::{Gc, JsCell, JsString, JsSymbol, Value};

/// A property key that came from a value: the string or symbol, which owns the name.
pub struct PropertyKey {
    name: NonNull<StringImpl>,
    owner: Gc<JsCell>,
}

impl PropertyKey {
    /// # Safety
    /// The string has just been atomized.
    #[inline(always)]
    pub(crate) unsafe fn from_atom_string(string: Gc<JsString>, name: NonNull<StringImpl>) -> Self {
        PropertyKey {
            name,
            owner: string.cell(),
        }
    }

    #[inline(always)]
    pub fn from_symbol(symbol: Gc<JsSymbol>) -> PropertyKey {
        PropertyKey {
            name: symbol.name().as_ptr(),
            owner: symbol.cell(),
        }
    }

    #[inline(always)]
    pub fn name(&self) -> PropertyName<'_> {
        // SAFETY: the owner holds it, and is alive until `self` is dropped.
        unsafe { PropertyName::from_raw(self.name) }
    }

    #[inline(always)]
    pub fn value(&self) -> Value {
        self.owner.into()
    }

    pub fn to_identifier(&self) -> Identifier {
        self.name().to_identifier()
    }
}

impl Drop for PropertyKey {
    #[inline(always)]
    fn drop(&mut self) {
        keep_alive(self.owner.address());
    }
}
