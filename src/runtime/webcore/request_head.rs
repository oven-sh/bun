//! The copy of a uWS request head that outlives the server dispatch, for `Request.url`/`.headers`.

use core::ptr::NonNull;

use bun_uws::Request as UwsRequest;

/// One allocation: a `u32` length, that many raw head bytes, then the padding uWS parses past.
#[repr(transparent)]
pub(crate) struct RequestHeadSnapshot(NonNull<u8>);

const LEN_PREFIX: usize = core::mem::size_of::<u32>();

impl RequestHeadSnapshot {
    pub(crate) fn capture(req: &UwsRequest) -> Self {
        let head = req.raw_head();
        let len = u32::try_from(head.len()).expect("uWS measures a head with an unsigned int");
        let mut bytes = Box::<[u8]>::new_uninit_slice(Self::allocation_size(head.len()));
        let start = bytes.as_mut_ptr().cast::<u8>();
        // SAFETY: the three writes fill the allocation exactly: prefix, head, padding.
        let bytes = unsafe {
            start.copy_from_nonoverlapping(len.to_ne_bytes().as_ptr(), LEN_PREFIX);
            let copy = start.add(LEN_PREFIX);
            copy.copy_from_nonoverlapping(head.as_ptr(), head.len());
            copy.add(head.len())
                .write_bytes(0, UwsRequest::RAW_HEAD_POST_PADDING);
            bytes.assume_init()
        };
        Self(NonNull::from(Box::leak(bytes)).cast::<u8>())
    }

    /// Hands the allocation to a raw slot. [`Self::from_raw`] takes it back.
    pub(crate) fn into_raw(self) -> NonNull<u8> {
        core::mem::ManuallyDrop::new(self).0
    }

    /// Safety: `ptr` comes from [`Self::into_raw`] and is taken back only once.
    pub(crate) unsafe fn from_raw(ptr: NonNull<u8>) -> Self {
        Self(ptr)
    }

    /// Parses the copy with uWS again and lends the request to `f`. `f` must not come back here.
    pub(crate) fn with_request<R>(&self, f: impl FnOnce(&UwsRequest) -> R) -> Option<R> {
        let len = self.len() + UwsRequest::RAW_HEAD_POST_PADDING;
        // SAFETY: `capture` laid these bytes out after the prefix, and only this call borrows them.
        let copy = unsafe { core::slice::from_raw_parts_mut(self.0.as_ptr().add(LEN_PREFIX), len) };
        UwsRequest::with_raw_head_copy(copy, f)
    }

    pub(crate) fn memory_cost(&self) -> usize {
        Self::allocation_size(self.len())
    }

    const fn allocation_size(head_len: usize) -> usize {
        LEN_PREFIX + head_len + UwsRequest::RAW_HEAD_POST_PADDING
    }

    fn len(&self) -> usize {
        // SAFETY: the allocation starts with the prefix `capture` wrote.
        u32::from_ne_bytes(unsafe { self.0.as_ptr().cast::<[u8; LEN_PREFIX]>().read() }) as usize
    }
}

impl Drop for RequestHeadSnapshot {
    fn drop(&mut self) {
        let size = Self::allocation_size(self.len());
        // SAFETY: reassembles the `Box<[u8]>` that `capture` leaked; this is its one owner.
        drop(unsafe { Box::from_raw(core::ptr::slice_from_raw_parts_mut(self.0.as_ptr(), size)) });
    }
}
