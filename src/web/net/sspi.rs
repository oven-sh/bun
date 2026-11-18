//! SPNEGO and NTLM for who is logged in: https://learn.microsoft.com/windows/win32/secauthn/sspi

use core::ffi::c_void;
use core::ptr::{null, null_mut};
use std::sync::OnceLock;

use bun_core::ZStr;

use super::auth::{AuthScheme, Peer, channel_binding};
use super::library::library;

type Handle = [usize; 2];

#[repr(C)]
struct Buffer {
    length: u32,
    kind: u32,
    value: *const u8,
}

#[repr(C)]
struct Buffers {
    version: u32,
    count: u32,
    first: *mut Buffer,
}

library! {
    Library b"sspicli.dll"
    AcquireCredentialsHandleW: fn(*const u16, *const u16, u32, *const c_void, *const c_void, *const c_void, *const c_void, &mut Handle, *mut i64) -> i32;
    InitializeSecurityContextW: fn(&Handle, *const Handle, *const u16, u32, u32, u32, &Buffers, u32, *mut Handle, &mut Buffers, &mut u32, *mut i64) -> i32;
    FreeContextBuffer: fn(*const u8) -> i32;
    DeleteSecurityContext: fn(&Handle) -> i32;
    FreeCredentialsHandle: fn(&Handle) -> i32;
}

pub(super) struct Context {
    library: &'static Library,
    credentials: Handle,
    context: Option<Handle>,
    service: Vec<u16>,
    /// `SEC_CHANNEL_BINDINGS`
    binding: Option<Vec<u8>>,
    delegates: bool,
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain([0]).collect()
}

impl Context {
    pub(super) fn new(scheme: AuthScheme, peer: &Peer<'_>) -> Option<Context> {
        const OUTBOUND: u32 = 2;
        static LIBRARY: OnceLock<Option<Library>> = OnceLock::new();
        let library = LIBRARY.get_or_init(Library::open).as_ref()?;
        let package = match scheme {
            AuthScheme::Ntlm => "NTLM",
            _ => "Negotiate",
        };
        let service = wide(&format!("HTTP/{}", str::from_utf8(peer.hostname).ok()?));
        let mut credentials = [0; 2];
        // SAFETY: a terminated string, and what is null is optional.
        let status = unsafe {
            (library.AcquireCredentialsHandleW)(
                null(),
                wide(package).as_ptr(),
                OUTBOUND,
                null(),
                null(),
                null(),
                null(),
                &mut credentials,
                null_mut(),
            )
        };
        let bind = || {
            let data = channel_binding(peer.certificate);
            let head = [0, 0, 0, 0, 0, 0, data.len() as u32, 32];
            [bun_core::slice_as_bytes(&head), &data].concat()
        };
        (status == 0).then(|| Context {
            library,
            credentials,
            context: None,
            service,
            binding: (!peer.certificate.is_empty()).then(bind),
            delegates: peer.may_act_as_user,
        })
    }

    /// May wait for the network.
    pub(super) fn step(&mut self, token: &[u8]) -> Option<Vec<u8>> {
        const TOKEN: u32 = 2;
        const CHANNEL_BINDINGS: u32 = 14;
        const DELEGATE_AND_MUTUAL: u32 = 3;
        const ALLOCATES: u32 = 0x100;
        const NATIVE: u32 = 0x10;
        const CONTINUE_NEEDED: i32 = 0x9_0312;
        let buffer = |kind, bytes: &[u8]| Buffer {
            length: bytes.len() as u32,
            kind,
            value: bytes.as_ptr(),
        };
        let token = (!token.is_empty()).then(|| buffer(TOKEN, token));
        let binding = (self.binding.as_ref()).map(|it| buffer(CHANNEL_BINDINGS, it));
        let mut input: Vec<_> = token.into_iter().chain(binding).collect();
        let mut output = Buffer {
            length: 0,
            kind: TOKEN,
            value: null(),
        };
        let mut context = self.context.unwrap_or_default();
        let place = &raw mut context;
        // SAFETY: the arguments outlive the call, and what is null is optional.
        let status = unsafe {
            (self.library.InitializeSecurityContextW)(
                &self.credentials,
                if self.context.is_some() {
                    place
                } else {
                    null()
                },
                self.service.as_ptr(),
                ALLOCATES
                    | if self.delegates {
                        DELEGATE_AND_MUTUAL
                    } else {
                        0
                    },
                0,
                NATIVE,
                &Buffers {
                    version: 0,
                    count: input.len() as u32,
                    first: input.as_mut_ptr(),
                },
                0,
                place,
                &mut Buffers {
                    version: 0,
                    count: 1,
                    first: &raw mut output,
                },
                &mut 0,
                null_mut(),
            )
        };
        if status >= 0 {
            self.context = Some(context);
        }
        if output.value.is_null() {
            return None;
        }
        // SAFETY: the library has allocated it, and it is not used after it is released.
        let next = unsafe {
            let next = core::slice::from_raw_parts(output.value, output.length as usize).to_vec();
            (self.library.FreeContextBuffer)(output.value);
            next
        };
        matches!(status, 0 | CONTINUE_NEEDED).then_some(next)
    }
}

impl Drop for Context {
    fn drop(&mut self) {
        // SAFETY: both are from the library, and are not used any more.
        unsafe {
            if let Some(context) = &self.context {
                (self.library.DeleteSecurityContext)(context);
            }
            (self.library.FreeCredentialsHandle)(&self.credentials);
        }
    }
}
