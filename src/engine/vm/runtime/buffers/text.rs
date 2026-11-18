//! Bytes from and to text.

use core::mem::MaybeUninit;

use bun_alloc::AllocError;
use bun_engine_text::{
    Base64Alphabet, BinarySyntaxError, Cursor, LastChunkHandling, Progress, StringRef, Text,
};

use super::create::Filler;
use crate::{Cx, JsResult, JsUint8Array};

impl Filler<'_, u8> {
    pub fn write(&mut self, write: impl FnOnce(&mut Cursor<'_, u8>)) {
        self.write_some(|rest| {
            let first = rest.as_ptr().cast::<MaybeUninit<u8>>();
            // SAFETY: memory that nothing else has yet.
            let rest = unsafe { core::slice::from_raw_parts_mut(first, rest.len()) };
            Cursor::fill_uninit(rest, write).len()
        });
    }
}

impl JsUint8Array {
    /// `decode` touches no cell, and behaves with room for `enough` bytes as it does with more.
    fn set_decoded(
        &self,
        cx: &mut Cx,
        enough: usize,
        decode: impl FnOnce(&mut Cursor<'_, u8>) -> Result<usize, BinarySyntaxError>,
    ) -> JsResult<Progress> {
        let no_gc = cx.no_gc();
        let target = self.elements(&no_gc).clamped(0..enough);
        let mut result = Ok(0);
        let decode = |to: &mut Cursor<'_, u8>| result = decode(to);
        let written = if self.may_be_used_by_other_threads() {
            let mut decoded = Vec::new();
            if Cursor::extend_vec(&mut decoded, target.len(), decode).is_err() {
                return Err(cx.throw_out_of_memory());
            }
            target.slice(0..decoded.len()).copy_from_slice(&decoded);
            decoded.len()
        } else {
            // SAFETY: nothing else gets at them meanwhile.
            let target = unsafe { core::slice::from_raw_parts_mut(target.as_ptr(), target.len()) };
            Cursor::fill(target, decode)
        };
        match result {
            Ok(read) => Ok(Progress { read, written }),
            Err(error) => Err(cx.throw_syntax_error(error.message())),
        }
    }

    pub fn set_from_base64(
        &self,
        cx: &mut Cx,
        text: Text<'_>,
        alphabet: Base64Alphabet,
        last: LastChunkHandling,
    ) -> JsResult<Progress> {
        const CHUNK: usize = 3;
        self.set_decoded(cx, text.base64_decoded_capacity() + CHUNK, |to| {
            text.decode_base64_that_fits(alphabet, last, to)
        })
    }

    pub fn set_from_hex(&self, cx: &mut Cx, text: Text<'_>) -> JsResult<Progress> {
        self.set_decoded(cx, text.len() / 2, |to| text.decode_hex_that_fits(to))
    }

    /// `encode` gets the bytes, or a copy if they can change meanwhile.
    pub fn encode(
        &self,
        cx: &mut Cx,
        encode: impl FnOnce(&[u8]) -> Result<StringRef, AllocError>,
    ) -> Result<StringRef, AllocError> {
        if let Some(bytes) = self.borrow_bytes(cx) {
            return encode(&bytes);
        }
        encode(&self.bytes(&cx.no_gc()).try_to_vec()?)
    }
}
