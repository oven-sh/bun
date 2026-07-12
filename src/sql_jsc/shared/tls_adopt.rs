use bun_usockets as uws;

/// In-place client TCP→TLS adoption (C10 no-relocation): the header keeps its
/// address+generation so the caller's `SocketRef` stays valid; ext repoint +
/// handle swap happen BEFORE the handshake kick. `false` = refused (R3.5).
pub fn adopt_socket_into_tls<Ext>(
    tcp: uws::SocketTCP,
    tls_group: &mut uws::SocketGroup,
    kind: uws::SocketKind,
    ssl_ctx: &mut uws::SslCtx,
    sni: Option<&core::ffi::CStr>,
    ext_owner: *mut Ext,
    set_socket_field: impl FnOnce(uws::SocketTLS),
) -> bool {
    let uws::InternalSocket::Connected(sref) = tcp.socket else {
        return false;
    };
    // `Option<NonNull<Ext>>` is the 8-byte null-niche shape the trampoline
    // reader (uws_handlers.rs) expects; `Option<*mut Ext>` would request 16
    // bytes (separate discriminant) and desync the slot.
    let ext_size = core::mem::size_of::<Option<core::ptr::NonNull<Ext>>>() as i32;
    // Stale `sref` (recycled slot) reads as closed here; bail before the raw
    // deref below so the generation check is self-enforcing.
    if tcp.is_closed() {
        return false;
    }
    // SAFETY: `is_closed()` above resolved `sref`'s generation; nothing
    // between it and this deref can close or recycle the slot.
    let sock: &mut uws::us_socket_t = unsafe { &mut *sref.ptr.as_ptr() };
    if sock
        .adopt_tls(
            tls_group,
            kind,
            ssl_ctx,
            sni,
            true, // is_client
            ext_size,
            ext_size,
        )
        .is_none()
    {
        return false;
    }
    *sock.ext::<Option<core::ptr::NonNull<Ext>>>() = core::ptr::NonNull::new(ext_owner);
    set_socket_field(uws::SocketTLS {
        socket: uws::InternalSocket::Connected(sref),
    });
    // ext is now repointed; safe to kick the handshake (any dispatch lands
    // on the TLS owner).
    sock.start_tls_handshake();
    true
}
