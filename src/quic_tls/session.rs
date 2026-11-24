use core::ffi::{CStr, c_char, c_int, c_uint, c_void};
use core::ptr::{NonNull, null, null_mut};
use std::rc::Rc;

use bun_boringssl_sys::{self as ssl, SSL, SSL_CTX, SSL_SESSION};
use bun_core::ffi::slice;
use bun_quic::crypto::Cipher;
use bun_quic::tls::{self, Alert, Handshake, Level, Status};
use bun_quic::{Side, Version};

bun_opaque::opaque_ffi! {
    struct SSL_CIPHER;
}

type SetSecret = unsafe extern "C" fn(&SSL, c_uint, &SSL_CIPHER, *const u8, usize) -> c_int;

/// `struct ssl_quic_method_st`.
#[repr(C)]
struct SSL_QUIC_METHOD {
    set_read_secret: SetSecret,
    set_write_secret: SetSecret,
    add_handshake_data: unsafe extern "C" fn(&SSL, c_uint, *const u8, usize) -> c_int,
    flush_flight: extern "C" fn(&SSL) -> c_int,
    send_alert: extern "C" fn(&SSL, c_uint, u8) -> c_int,
}

const SSL_ERROR_EARLY_DATA_REJECTED: c_int = 15;
/// As in a packed error.
const ERR_LIB_SSL: u32 = 16 << 24;
const SSL_R_DECODE_ERROR: u32 = 137;
const SSL_R_INVALID_ALPN_PROTOCOL: u32 = 259;
const SSL_R_UNEXPECTED_COMPATIBILITY_MODE: u32 = 306;
const SSL_SESS_CACHE_CLIENT: c_int = 1;
const SSL_VERIFY_OK: c_uint = 0;
const SSL_VERIFY_INVALID: c_uint = 1;
/// The one that `SSL_set_app_data` uses.
const EX_INDEX: c_int = 0;

unsafe extern "C" {
    safe fn SSL_set_quic_method(ssl: &SSL, method: &'static SSL_QUIC_METHOD) -> c_int;
    safe fn SSL_set_quic_use_legacy_codepoint(ssl: &SSL, use_legacy: c_int);
    fn SSL_set_quic_transport_params(ssl: &SSL, params: *const u8, len: usize) -> c_int;
    safe fn SSL_get_peer_quic_transport_params(ssl: &SSL, params: &mut *const u8, len: &mut usize);
    fn SSL_set_quic_early_data_context(ssl: &SSL, context: *const u8, len: usize) -> c_int;
    fn SSL_provide_quic_data(ssl: &SSL, level: c_uint, data: *const u8, len: usize) -> c_int;
    fn SSL_process_quic_post_handshake(ssl: &SSL) -> c_int;
    safe fn SSL_in_init(ssl: &SSL) -> c_int;
    safe fn SSL_is_quic(ssl: &SSL) -> c_int;
    safe fn SSL_early_data_accepted(ssl: &SSL) -> c_int;
    fn SSL_reset_early_data_reject(ssl: &SSL);
    safe fn SSL_CIPHER_get_protocol_id(cipher: &SSL_CIPHER) -> u16;
    safe fn SSL_get_current_cipher(ssl: &SSL) -> Option<&SSL_CIPHER>;
    safe fn SSL_CIPHER_get_name(cipher: &SSL_CIPHER) -> *const c_char;
    fn SSL_set_cert_cb(ssl: &SSL, cb: extern "C" fn(&SSL, *mut c_void) -> c_int, arg: *mut c_void);
    safe fn SSL_set_custom_verify(
        ssl: &SSL,
        mode: c_int,
        cb: extern "C" fn(&SSL, &mut u8) -> c_uint,
    );
    fn SSL_set_SSL_CTX(ssl: &SSL, ctx: &SSL_CTX) -> *mut SSL_CTX;
    safe fn SSL_CTX_get_verify_callback(ctx: &SSL_CTX) -> ssl::SSL_verify_cb;
    safe fn SSL_set_verify_depth(ssl: &SSL, depth: c_int);
    safe fn SSL_CTX_get_verify_depth(ctx: &SSL_CTX) -> c_int;
    safe fn SSL_get_options(ssl: &SSL) -> u32;
    safe fn SSL_CTX_get_options(ctx: &SSL_CTX) -> u32;
    fn SSL_CTX_set_session_cache_mode(ctx: &SSL_CTX, mode: c_int) -> c_int;
    fn SSL_CTX_sess_set_new_cb(ctx: &SSL_CTX, cb: extern "C" fn(&SSL, &SSL_SESSION) -> c_int);
    safe fn SSL_get0_session_id_context(ssl: &SSL, len: &mut usize) -> *const u8;
    safe fn SSL_SESSION_get0_id_context(session: &SSL_SESSION, len: &mut c_uint) -> *const u8;
    safe fn SSL_SESSION_to_bytes(
        session: &SSL_SESSION,
        data: &mut *mut u8,
        len: &mut usize,
    ) -> c_int;
    fn SSL_SESSION_from_bytes(
        data: *const u8,
        len: usize,
        ctx: *const SSL_CTX,
    ) -> Option<ssl::OwnedSslSession>;
}

type SelectContext = dyn Fn(Option<&[u8]>) -> Option<ssl::OwnedSslCtx>;
type Verify = dyn Fn(&SSL) -> bool;

pub struct Session {
    ssl: NonNull<SSL>,
    select_context: Option<Box<SelectContext>>,
    verify: Option<Box<Verify>>,
    protocols: Option<Rc<[u8]>>,
    has_started: bool,
    has_local_parameters: bool,
    has_peer_parameters: bool,
    has_sent_tickets: bool,
    is_complete: bool,
}

/// What the callbacks of BoringSSL work with.
struct Call<'a, 'b> {
    session: &'a mut Session,
    handshake: &'a mut Handshake<'b>,
    alert: Option<Alert>,
}

impl Session {
    pub fn new(ctx: &SSL_CTX, side: Side) -> Option<Self> {
        static METHOD: SSL_QUIC_METHOD = SSL_QUIC_METHOD {
            set_read_secret: set_secret::<true>,
            set_write_secret: set_secret::<false>,
            add_handshake_data,
            flush_flight,
            send_alert,
        };
        // SAFETY: `ctx` is live, and the `SSL` takes its own reference.
        let ssl = NonNull::new(unsafe { ssl::SSL_new(ctx.as_mut_ptr()) })?;
        let this = Self {
            ssl,
            select_context: None,
            verify: None,
            protocols: None,
            has_started: false,
            has_local_parameters: false,
            has_peer_parameters: false,
            has_sent_tickets: false,
            is_complete: false,
        };
        // SAFETY: `ssl` is live.
        unsafe {
            match side {
                Side::Client => ssl::SSL_set_connect_state(ssl.as_ptr()),
                Side::Server => ssl::SSL_set_accept_state(ssl.as_ptr()),
            }
        }
        (SSL_set_quic_method(this.ssl(), &METHOD) == 1).then_some(this)
    }

    pub fn of(connection: &bun_quic::Connection) -> Option<&Self> {
        let session: &dyn core::any::Any = connection.tls()?;
        session.downcast_ref()
    }

    pub fn ssl(&self) -> &SSL {
        SSL::opaque_ref(self.ssl.as_ptr())
    }

    pub fn ssl_mut(&mut self) -> &mut SSL {
        SSL::opaque_mut(self.ssl.as_ptr())
    }

    pub fn cipher_name(&self) -> Option<&'static CStr> {
        let name = SSL_CIPHER_get_name(SSL_get_current_cipher(self.ssl())?);
        // SAFETY: the names of ciphers are static strings.
        Some(unsafe { CStr::from_ptr(name) })
    }

    /// For a client. `protocols` has the format of RFC 7301 §3.1.
    pub fn offer(&mut self, protocols: &[u8]) -> Option<()> {
        let (ssl, at) = (self.ssl.as_ptr(), protocols.as_ptr());
        // SAFETY: BoringSSL copies `protocols`.
        (unsafe { ssl::SSL_set_alpn_protos(ssl, at, protocols.len()) } == 0).then_some(())
    }

    /// For a server, in place of the name that HTTP/3 has in the version of the connection.
    pub fn accept(&mut self, protocols: Rc<[u8]>) {
        self.protocols = Some(protocols);
    }

    /// For a server, to go on with another context, if there is one for the name that the client asks for.
    pub fn select_context_with(&mut self, select: Box<SelectContext>) {
        self.select_context = Some(select);
        // SAFETY: the callback does not use its argument.
        unsafe { SSL_set_cert_cb(self.ssl(), select_context, null_mut()) };
    }

    /// In place of the verification that the context is set up for.
    pub fn verify_with(&mut self, verify: Box<Verify>) {
        self.verify = Some(verify);
        SSL_set_custom_verify(self.ssl(), ssl::SSL_VERIFY_PEER, verify_peer);
    }

    /// BoringSSL does not compare them before the server has replied.
    fn has_context_of(&self, session: &SSL_SESSION) -> bool {
        let (mut our_len, mut its_len) = (0, 0);
        let ours = SSL_get0_session_id_context(self.ssl(), &mut our_len);
        let its = SSL_SESSION_get0_id_context(session, &mut its_len);
        // SAFETY: BoringSSL returns them with their lengths.
        unsafe { slice(ours, our_len) == slice(its, its_len as usize) }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        // SAFETY: we own it.
        unsafe { ssl::SSL_free(self.ssl.as_ptr()) }
    }
}

impl tls::Session for Session {
    fn resume(&mut self, ticket: &[u8]) -> bool {
        let ssl = self.ssl.as_ptr();
        // SAFETY: `ticket` is valid for its length, and the `SSL` takes its own reference.
        let is_set = unsafe {
            SSL_SESSION_from_bytes(ticket.as_ptr(), ticket.len(), ssl::SSL_get_SSL_CTX(ssl))
                .filter(|session| self.has_context_of(SSL_SESSION::opaque_ref(session.as_ptr())))
                .is_some_and(|session| ssl::SSL_set_session(ssl, session.as_ptr()) == 1)
        };
        ssl::ERR_clear_error();
        is_set
    }

    fn advance(
        &mut self,
        input: Option<(Level, &[u8])>,
        handshake: &mut Handshake<'_>,
    ) -> Result<Status, Alert> {
        let ssl = SSL::opaque_ref(self.ssl.as_ptr());
        if !core::mem::replace(&mut self.has_started, true) {
            let is_draft = handshake.version() == Version::Draft29;
            SSL_set_quic_use_legacy_codepoint(ssl, is_draft.into());
            if input.is_some() {
                let context = handshake.early_data_context();
                // SAFETY: BoringSSL copies `context`.
                unsafe { SSL_set_quic_early_data_context(ssl, context.as_ptr(), context.len()) };
            }
        }
        let mut call = Call {
            session: self,
            handshake,
            alert: None,
        };
        let call = &raw mut call;
        // SAFETY: `call` outlives the time it is registered, and is only used through this pointer.
        unsafe {
            if ssl::SSL_set_ex_data(ssl.as_mut_ptr(), EX_INDEX, call.cast()) != 1 {
                return Err(Alert::INTERNAL_ERROR);
            }
            let status = advance(ssl, input, call);
            ssl::SSL_set_ex_data(ssl.as_mut_ptr(), EX_INDEX, null_mut());
            let status = status.ok_or_else(|| (*call).failure());
            ssl::ERR_clear_error();
            status
        }
    }
}

/// # Safety
/// `call` is the one that is registered with `ssl`.
unsafe fn advance(ssl: &SSL, input: Option<(Level, &[u8])>, call: *mut Call) -> Option<Status> {
    // SAFETY: references into `call` end before BoringSSL is entered.
    unsafe {
        match input {
            Some((level, data)) => {
                let (at, len) = (data.as_ptr(), data.len());
                (SSL_provide_quic_data(ssl, level as c_uint, at, len) == 1).then_some(())?;
            }
            None => (*call).set_local_parameters(ssl)?,
        }
        while !(*call).session.is_complete {
            let result = ssl::SSL_do_handshake(ssl.as_mut_ptr());
            if result == 1 && SSL_in_init(ssl) == 0 {
                (*call).session.is_complete = true;
            } else if result != 1 {
                match ssl::SSL_get_error(ssl.as_mut_ptr(), result) {
                    ssl::SSL_ERROR_WANT_READ => return Some(Status::InProgress),
                    SSL_ERROR_EARLY_DATA_REJECTED => {
                        SSL_reset_early_data_reject(ssl);
                        (*call).handshake.early_data_rejected();
                    }
                    _ => return None,
                }
            }
        }
        (*call).get_peer_parameters(ssl)?;
        (SSL_process_quic_post_handshake(ssl) == 1).then_some(Status::Complete)
    }
}

impl Call<'_, '_> {
    fn with<T>(ssl: &SSL, f: impl FnOnce(&mut Call) -> Option<T>) -> Option<T> {
        (SSL_is_quic(ssl) == 1).then_some(())?;
        // SAFETY: it is null or the `Call` of the `advance` that is on the stack, which holds no reference into it.
        f(unsafe { ssl::SSL_get_ex_data(ssl, EX_INDEX).cast::<Call>().as_mut() }?)
    }

    /// RFC 9001 §4.6.1, §8.1 and §8.4.
    fn failure(&mut self) -> Alert {
        let alert = self.alert.unwrap_or(Alert::INTERNAL_ERROR);
        if alert == Alert::ILLEGAL_PARAMETER {
            match ssl::ERR_get_error() ^ ERR_LIB_SSL {
                SSL_R_INVALID_ALPN_PROTOCOL => return Alert::NO_APPLICATION_PROTOCOL,
                SSL_R_DECODE_ERROR if self.session.is_complete => self.handshake.violation(),
                SSL_R_UNEXPECTED_COMPATIBILITY_MODE => self.handshake.violation(),
                _ => {}
            }
        }
        alert
    }

    fn set_local_parameters(&mut self, ssl: &SSL) -> Option<()> {
        if !core::mem::replace(&mut self.session.has_local_parameters, true) {
            let parameters = self.handshake.local_parameters();
            // SAFETY: BoringSSL copies `parameters`.
            let result = unsafe {
                SSL_set_quic_transport_params(ssl, parameters.as_ptr(), parameters.len())
            };
            (result == 1).then_some(())?;
        }
        Some(())
    }

    fn get_peer_parameters(&mut self, ssl: &SSL) -> Option<()> {
        if !core::mem::replace(&mut self.session.has_peer_parameters, true) {
            let (mut at, mut len) = (null(), 0);
            SSL_get_peer_quic_transport_params(ssl, &mut at, &mut len);
            // SAFETY: they are valid for as long as `ssl` is left alone.
            let parameters = unsafe { slice(at, len) };
            let accepts_early_data = SSL_early_data_accepted(ssl) == 1;
            let handshake = &mut *self.handshake;
            (handshake.peer_parameters(parameters, accepts_early_data)).then_some(())?;
        }
        Some(())
    }
}

fn level_from(level: c_uint) -> Option<Level> {
    use Level::{Application, EarlyData, Handshake, Initial};
    [Initial, EarlyData, Handshake, Application]
        .get(level as usize)
        .copied()
}

fn cipher_from(cipher: &SSL_CIPHER) -> Option<Cipher> {
    match SSL_CIPHER_get_protocol_id(cipher) {
        0x1301 => Some(Cipher::Aes128GcmSha256),
        0x1302 => Some(Cipher::Aes256GcmSha384),
        0x1303 => Some(Cipher::ChaCha20Poly1305Sha256),
        _ => None,
    }
}

unsafe extern "C" fn set_secret<const IS_FOR_READING: bool>(
    ssl: &SSL,
    level: c_uint,
    cipher: &SSL_CIPHER,
    secret: *const u8,
    len: usize,
) -> c_int {
    let result = Call::with(ssl, |call| {
        let (level, cipher) = (level_from(level)?, cipher_from(cipher)?);
        // SAFETY: BoringSSL passes a secret of this length.
        let secret = unsafe { slice(secret, len) };
        match IS_FOR_READING {
            true => call.handshake.read_secret(level, cipher, secret),
            false => call.handshake.write_secret(level, cipher, secret),
        }
        Some(1)
    });
    result.unwrap_or(0)
}

unsafe extern "C" fn add_handshake_data(
    ssl: &SSL,
    level: c_uint,
    data: *const u8,
    len: usize,
) -> c_int {
    let result = Call::with(ssl, |call| {
        // What a server writes first comes before its keys and parameters, which depend on those of the client.
        if !call.session.has_local_parameters {
            call.get_peer_parameters(ssl)?;
            call.set_local_parameters(ssl)?;
        }
        // SAFETY: BoringSSL passes data of this length.
        let (level, data) = (level_from(level)?, unsafe { slice(data, len) });
        // It comes in pieces of 16 KiB, and one is what clients are known to have room for (RFC 9000 §7.5).
        if level != Level::Application {
            call.handshake.send(level, data);
        } else if !core::mem::replace(&mut call.session.has_sent_tickets, true) {
            call.handshake.send(level, usable_tickets(data));
        }
        Some(1)
    });
    result.unwrap_or(0)
}

/// Those that are whole (RFC 8446 §4), and not too long for a ClientHello message.
fn usable_tickets(data: &[u8]) -> &[u8] {
    const MAX_LEN: u32 = 13 * 1024;
    let mut rest = data;
    while let [_, a, b, c, body @ ..] = rest
        && let len @ ..=MAX_LEN = u32::from_be_bytes([0, *a, *b, *c])
        && let Some(next) = body.get(len as usize..)
    {
        rest = next;
    }
    data.split_at(data.len() - rest.len()).0
}

extern "C" fn flush_flight(_: &SSL) -> c_int {
    1
}

extern "C" fn send_alert(ssl: &SSL, _level: c_uint, alert: u8) -> c_int {
    Call::with(ssl, |call| call.alert.replace(Alert(alert)));
    1
}

extern "C" fn select_context(ssl: &SSL, _: *mut c_void) -> c_int {
    let result = Call::with(ssl, |call| {
        let Some(ctx) = call.session.select_context.as_ref()?(ssl.servername()) else {
            return Some(1);
        };
        let at = ssl.as_mut_ptr();
        // SAFETY: both are live, and `ssl` takes its own reference.
        unsafe {
            NonNull::new(SSL_set_SSL_CTX(ssl, &ctx))?;
            let mode = ssl::SSL_CTX_get_verify_mode(ctx.as_ptr());
            ssl::SSL_set_verify(at, mode, SSL_CTX_get_verify_callback(&ctx));
            SSL_set_verify_depth(ssl, SSL_CTX_get_verify_depth(&ctx));
            ssl::SSL_clear_options(at, SSL_get_options(ssl));
            ssl::SSL_set_options(at, SSL_CTX_get_options(&ctx));
        }
        Some(1)
    });
    result.unwrap_or(0)
}

extern "C" fn verify_peer(ssl: &SSL, _alert: &mut u8) -> c_uint {
    match Call::with(ssl, |call| Some(call.session.verify.as_ref()?(ssl))) {
        Some(true) => SSL_VERIFY_OK,
        _ => SSL_VERIFY_INVALID,
    }
}

/// # Safety
/// `ctx` is not shared yet.
pub unsafe fn enable_tickets(ctx: &SSL_CTX) {
    extern "C" fn new_session(ssl: &SSL, session: &SSL_SESSION) -> c_int {
        let (mut at, mut len) = (null_mut(), 0);
        if SSL_SESSION_to_bytes(session, &mut at, &mut len) == 1 {
            // SAFETY: BoringSSL allocated `len` bytes there for us.
            let ticket = unsafe { ssl::OpensslBytes::from_raw(at, len) };
            Call::with(ssl, |call| ticket.map(|it| call.handshake.ticket(&it)));
        }
        0
    }
    // SAFETY: the caller's.
    unsafe {
        SSL_CTX_set_session_cache_mode(ctx, SSL_SESS_CACHE_CLIENT);
        SSL_CTX_sess_set_new_cb(ctx, new_session);
    }
}

/// # Safety
/// `ctx` is not shared yet.
pub unsafe fn enable_key_log(ctx: &SSL_CTX) {
    unsafe extern "C" fn key_log(ssl: *const SSL, line: *const c_char) {
        Call::with(SSL::opaque_ref(ssl), |call| {
            // SAFETY: BoringSSL passes a string.
            (call.handshake).key_log(unsafe { CStr::from_ptr(line) }.to_bytes());
            Some(())
        });
    }
    // SAFETY: the caller's.
    unsafe { ssl::SSL_CTX_set_keylog_callback(ctx.as_mut_ptr(), Some(key_log)) };
}

/// For a server. See [`Session::accept`].
///
/// # Safety
/// `ctx` is not shared yet.
pub unsafe fn enable_alpn(ctx: &SSL_CTX) {
    unsafe extern "C" fn select(
        ssl: *mut SSL,
        out: *mut *const u8,
        out_len: *mut u8,
        offered: *const u8,
        offered_len: c_uint,
        _: *mut c_void,
    ) -> c_int {
        let result = Call::with(SSL::opaque_ref(ssl), |call| {
            let ours = (call.session.protocols.as_deref())
                .unwrap_or_else(|| call.handshake.version().http3_alpn());
            let (at, len) = (ours.as_ptr(), ours.len() as c_uint);
            // SAFETY: the other pointers are those of BoringSSL, which copies the name when this returns.
            Some(unsafe {
                ssl::SSL_select_next_proto(out.cast(), out_len, at, len, offered, offered_len)
            })
        });
        match result {
            Some(ssl::OPENSSL_NPN_NEGOTIATED) => ssl::SSL_TLSEXT_ERR_OK,
            _ => ssl::SSL_TLSEXT_ERR_ALERT_FATAL,
        }
    }
    // SAFETY: the caller's.
    unsafe { ssl::SSL_CTX_set_alpn_select_cb(ctx.as_mut_ptr(), Some(select), null_mut()) };
}
