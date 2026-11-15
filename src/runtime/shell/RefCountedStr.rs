use bun_ptr::RefPtr;

bun_core::declare_scope!(RefCountedEnvStr, hidden);

#[derive(bun_ptr::RefCounted)]
pub(crate) struct RefCountedStr {
    ref_count: bun_ptr::RefCount,
    data: Box<[u8]>,
}

impl RefCountedStr {
    pub(crate) fn init(data: Box<[u8]>) -> RefPtr<RefCountedStr> {
        bun_core::scoped_log!(RefCountedEnvStr, "init: {}", bstr::BStr::new(&*data));
        RefPtr::new(RefCountedStr {
            ref_count: bun_ptr::RefCount::init(),
            data,
        })
    }

    pub(crate) fn byte_slice(&self) -> &[u8] {
        &self.data
    }
}

impl Drop for RefCountedStr {
    fn drop(&mut self) {
        bun_core::scoped_log!(RefCountedEnvStr, "deinit: {}", bstr::BStr::new(&*self.data));
    }
}
