bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for `WebCore::CloneSerializer`.
    pub struct CloneSerializer;
}

impl bun_io::Write for CloneSerializer {
    #[inline]
    fn write_all(&mut self, bytes: &[u8]) -> bun_io::Result<()> {
        // SAFETY: C++ copies `length` bytes out of `data` before it returns.
        unsafe { WebCore__CloneSerializer__write(self, bytes.as_ptr(), bytes.len() as u32) };
        Ok(())
    }
}

unsafe extern "C" {
    fn WebCore__CloneSerializer__write(this: &mut CloneSerializer, data: *const u8, length: u32);
}
