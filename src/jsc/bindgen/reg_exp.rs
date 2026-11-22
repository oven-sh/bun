use core::marker::PhantomData;

use bun_collections::smallvec::SmallVec;
use bun_core::{EncodedSlice, String};

use super::{Error, InvariantLifetime, JsHeap, NotSend, Result};
use crate::regular_expression::Flags;
use crate::{JSGlobalObject, JSValue};

/// A `JSC::RegExp`, the compiled pattern behind a `RegExp` object, held by a host call. It is a cell, but no JS value.
#[derive(Clone, Copy)]
pub struct JsRegExp<'a>(JSValue, InvariantLifetime<'a>, NotSend);

/// Where each group starts and ends, in code units. The start of one that took no part is negative.
pub type Captures = SmallVec<[[i32; 2]; 8]>;

unsafe extern "C" {
    safe fn JSC__RegExp__create(global: &JSGlobalObject, pattern: &String, flags: u8) -> JSValue;
    fn JSC__RegExp__test(
        reg_exp: JSValue,
        global: &JSGlobalObject,
        input: &EncodedSlice<'_>,
    ) -> bool;
    fn JSC__RegExp__exec(
        reg_exp: JSValue,
        global: &JSGlobalObject,
        input: &EncodedSlice<'_>,
        count: &mut u32,
    ) -> *const [i32; 2];
}

impl<'a> JsHeap<'a> {
    /// `None` if `pattern` is not valid.
    #[inline]
    pub fn create_reg_exp(&self, pattern: &String, flags: &[Flags]) -> Option<JsRegExp<'a>> {
        let flags = flags.iter().fold(0, |all, &flag| all | flag as u8);
        let reg_exp = JSC__RegExp__create(self.global_object(), pattern, flags);
        (!reg_exp.is_empty()).then_some(JsRegExp(reg_exp, PhantomData, PhantomData))
    }
}

impl<'a> JsRegExp<'a> {
    /// # Safety
    /// `cell` is a `JSC::RegExp` that something holds for the call `heap` belongs to.
    #[doc(hidden)]
    #[inline]
    pub unsafe fn from_extern(cell: JSValue, _: &JsHeap<'a>) -> Self {
        Self(cell, PhantomData, PhantomData)
    }

    /// # Safety
    /// JavaScript does not get the result.
    #[doc(hidden)]
    #[inline]
    pub unsafe fn to_js(self) -> JSValue {
        self.0
    }
}

/// `input` is Latin-1 or UTF-16.
impl<'a> JsRegExp<'a> {
    /// Whether it matches, with code that records no groups.
    #[inline]
    pub fn test(self, heap: &JsHeap<'a>, input: EncodedSlice<'_>) -> Result<'a, bool> {
        let global = heap.global_object();
        // SAFETY: `self` is a `JSC::RegExp`.
        crate::call_check_slow(global, || unsafe {
            JSC__RegExp__test(self.0, global, &input)
        })
        .map_err(Error::pending)
    }

    /// Whether it matches. If so, its groups are appended to `captures`.
    #[inline]
    pub fn exec(
        self,
        heap: &JsHeap<'a>,
        input: EncodedSlice<'_>,
        captures: Option<&mut Captures>,
    ) -> Result<'a, bool> {
        let global = heap.global_object();
        crate::call_check_slow(global, || {
            let mut count = 0;
            // SAFETY: `self` is a `JSC::RegExp`.
            let groups = unsafe { JSC__RegExp__exec(self.0, global, &input, &mut count) };
            if groups.is_null() {
                return false;
            }
            if let Some(captures) = captures {
                // SAFETY: the cell owns `count` pairs there, and nothing matches while they are copied.
                captures.extend_from_slice(unsafe {
                    core::slice::from_raw_parts(groups, count as usize)
                });
            }
            true
        })
        .map_err(Error::pending)
    }
}
