use bun_engine_macros::cell;

use super::element::{Bits, Element};
use super::slice::BufferSlice;
use crate::{Cx, JsArrayBufferView, JsResult, NoGc};

#[cell(name = "DataView", cell_type = DataView, export = "engine_class_DataView")]
pub struct JsDataView {
    base: JsArrayBufferView,
}

impl JsDataView {
    #[inline(always)]
    fn element_at<'a, T: Element>(
        &'a self,
        no_gc: &'a NoGc<'_>,
        byte_offset: u64,
    ) -> Option<BufferSlice<'a, T>> {
        let bytes = self.bytes(no_gc);
        Some(
            bytes
                .try_slice(byte_offset as usize, size_of::<T>())?
                .cast(),
        )
    }

    #[cold]
    fn throw_no_element<T>(&self, cx: &Cx) -> JsResult<T> {
        Err(if self.is_out_of_bounds() {
            JsArrayBufferView::throw_out_of_bounds(cx)
        } else {
            cx.throw_range_error("Out of bounds access")
        })
    }

    /// GetViewValue, once the arguments are converted.
    #[inline(always)]
    pub fn get_value<T: Element>(
        &self,
        cx: &mut Cx,
        byte_offset: u64,
        is_little_endian: bool,
    ) -> JsResult<T> {
        let element = self
            .element_at::<T>(&cx.no_gc(), byte_offset)
            .map(|it| it.bits().at(0));
        let Some(bits) = element else {
            return self.throw_no_element(cx);
        };
        Ok(T::from_bits(if is_little_endian {
            bits
        } else {
            bits.swap_bytes()
        }))
    }

    /// SetViewValue, once the arguments are converted.
    #[inline(always)]
    pub fn set_value<T: Element>(
        &self,
        cx: &mut Cx,
        byte_offset: u64,
        value: T,
        is_little_endian: bool,
    ) -> JsResult<()> {
        let bits = value.to_bits();
        let bits = if is_little_endian {
            bits
        } else {
            bits.swap_bytes()
        };
        match self.element_at::<T>(&cx.no_gc(), byte_offset) {
            Some(element) => element.bits().set(0, bits),
            None => return self.throw_no_element(cx),
        }
        Ok(())
    }
}
