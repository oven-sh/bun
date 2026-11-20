//! Masks the payload of a frame, or unmasks it.
use crate::Byte;
use bun_simd::{Out, SharedU8};

pub use simd::{mask, mask_from_shared, mask_in_place};

#[bun_simd::foreach_target]
mod simd {
    use isa::U8;

    #[inline(always)]
    fn mask_any<'a>(key: [u8; 4], from: &[impl Byte], to: Out<'a, u8>) -> &'a mut [u8] {
        let to = to.take(from.len());
        let (len, key) = (to.len(), u32::from_le_bytes(key));
        let key_at = |at: usize| U8::repeat(key.rotate_right(8 * (at % 4) as u32).to_le_bytes());
        if len >= U8::LEN {
            return to.fill_chunks(from, |at, from| {
                Some((U8::load(from) ^ key_at(at)).to_array())
            });
        }
        match U8::load_padded(&from[..len]) {
            Some(it) => (it.lanes ^ key_at(0)).store_partial(to),
            None => &mut [],
        }
    }

    #[export]
    pub fn mask<'a>(key: [u8; 4], from: &[u8], to: Out<'a, u8>) -> &'a mut [u8] {
        mask_any(key, from, to)
    }

    #[export]
    pub fn mask_from_shared<'a>(key: [u8; 4], from: &[SharedU8], to: Out<'a, u8>) -> &'a mut [u8] {
        mask_any(key, from, to)
    }

    #[export]
    pub fn mask_in_place(key: [u8; 4], bytes: &mut [u8]) {
        let (words, rest) = bytes.as_chunks_mut::<4>();
        let keys = U8::repeat(key);
        U8::map_in_place(words.as_flattened_mut(), |v| v ^ keys);
        for (byte, key) in rest.iter_mut().zip(key) {
            *byte ^= key;
        }
    }
}
