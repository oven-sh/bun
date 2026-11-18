//! SPNEGO by the library of the system: https://www.rfc-editor.org/rfc/rfc2744

use core::ffi::c_void;
use core::ptr::{null, null_mut};
use std::sync::OnceLock;

use bun_core::ZStr;
use bun_sys::DynLib;

use super::auth::{AuthScheme, Peer, channel_binding};

#[cfg_attr(all(target_os = "macos", target_arch = "x86_64"), repr(C, packed(2)))]
#[cfg_attr(not(all(target_os = "macos", target_arch = "x86_64")), repr(C))]
struct Oid {
    length: u32,
    elements: *const u8,
}

#[cfg_attr(all(target_os = "macos", target_arch = "x86_64"), repr(C, packed(2)))]
#[cfg_attr(not(all(target_os = "macos", target_arch = "x86_64")), repr(C))]
struct Buffer {
    length: usize,
    value: *const u8,
}

#[cfg_attr(all(target_os = "macos", target_arch = "x86_64"), repr(C, packed(2)))]
#[cfg_attr(not(all(target_os = "macos", target_arch = "x86_64")), repr(C))]
struct ChannelBindings {
    initiator_type: u32,
    initiator: Buffer,
    acceptor_type: u32,
    acceptor: Buffer,
    application_data: Buffer,
}

impl Oid {
    fn new(bytes: &'static [u8]) -> Oid {
        Oid {
            length: bytes.len() as u32,
            elements: bytes.as_ptr(),
        }
    }
}

impl Buffer {
    fn new(bytes: &[u8]) -> Buffer {
        Buffer {
            length: bytes.len(),
            value: bytes.as_ptr(),
        }
    }
}

type Handle = *mut c_void;

struct Library {
    import_name: unsafe extern "C" fn(&mut u32, &Buffer, &Oid, &mut Handle) -> u32,
    release_name: unsafe extern "C" fn(&mut u32, &mut Handle) -> u32,
    init_context: unsafe extern "C" fn(
        &mut u32,
        Handle,
        &mut Handle,
        Handle,
        &Oid,
        u32,
        u32,
        *const ChannelBindings,
        &Buffer,
        *mut c_void,
        &mut Buffer,
        *mut u32,
        *mut u32,
    ) -> u32,
    release_buffer: unsafe extern "C" fn(&mut u32, &mut Buffer) -> u32,
    delete_context: unsafe extern "C" fn(&mut u32, &mut Handle, *mut Buffer) -> u32,
    _opened: DynLib,
}

const NAMES: &[&[u8]] = if cfg!(target_os = "macos") {
    &[b"/System/Library/Frameworks/GSS.framework/GSS"]
} else {
    &[
        b"libgssapi_krb5.so.2",
        b"libgssapi.so.4",
        b"libgssapi.so.3",
        b"libgssapi.so.2",
        b"libgssapi.so.1",
    ]
};

fn library() -> Option<&'static Library> {
    static LIBRARY: OnceLock<Option<Library>> = OnceLock::new();
    let load = |name: &&[u8]| {
        // SAFETY: a library of the system, whose header has these types. `_opened` keeps it loaded.
        unsafe {
            let opened = DynLib::open(name).ok()?;
            Some(Library {
                import_name: opened.lookup_as(ZStr::from_slice_with_nul(b"gss_import_name\0"))?,
                release_name: opened.lookup_as(ZStr::from_slice_with_nul(b"gss_release_name\0"))?,
                init_context: opened
                    .lookup_as(ZStr::from_slice_with_nul(b"gss_init_sec_context\0"))?,
                release_buffer: opened
                    .lookup_as(ZStr::from_slice_with_nul(b"gss_release_buffer\0"))?,
                delete_context: opened
                    .lookup_as(ZStr::from_slice_with_nul(b"gss_delete_sec_context\0"))?,
                _opened: opened,
            })
        }
    };
    let find = || {
        let found = NAMES.iter().find_map(load);
        if found.is_none() {
            bun_core::warn!("Negotiate authentication is off: the system has no GSSAPI library");
        }
        found
    };
    LIBRARY.get_or_init(find).as_ref()
}

pub(super) struct Context {
    library: &'static Library,
    name: Handle,
    context: Handle,
    binding: Option<Vec<u8>>,
    delegates: bool,
}

// SAFETY: the handles are not tied to a thread, and only one uses them at a time.
unsafe impl Send for Context {}

impl Context {
    pub(super) fn new(_: AuthScheme, peer: &Peer<'_>) -> Option<Context> {
        const HOST_BASED_SERVICE: &[u8] = b"\x2a\x86\x48\x86\xf7\x12\x01\x02\x01\x04";
        let (library, service, mut name) =
            (library()?, [b"HTTP@", peer.hostname].concat(), null_mut());
        // SAFETY: the arguments outlive the call.
        let status = unsafe {
            (library.import_name)(
                &mut 0,
                &Buffer::new(&service),
                &Oid::new(HOST_BASED_SERVICE),
                &mut name,
            )
        };
        let binding = (!peer.certificate.is_empty()).then(|| channel_binding(peer.certificate));
        (status == 0).then_some(Context {
            library,
            name,
            context: null_mut(),
            binding,
            delegates: peer.may_act_as_user,
        })
    }

    /// May wait for the network.
    pub(super) fn step(&mut self, token: &[u8]) -> Option<Vec<u8>> {
        const SPNEGO: &[u8] = b"\x2b\x06\x01\x05\x05\x02";
        const CONTINUE_NEEDED: u32 = 1;
        let bindings = self.binding.as_ref().map(|it| ChannelBindings {
            initiator_type: 0,
            initiator: Buffer::new(b""),
            acceptor_type: 0,
            acceptor: Buffer::new(b""),
            application_data: Buffer::new(it),
        });
        let mut output = Buffer {
            length: 0,
            value: null(),
        };
        // SAFETY: the arguments outlive the call, and what may be null is optional.
        let status = unsafe {
            (self.library.init_context)(
                &mut 0,
                null_mut(),
                &mut self.context,
                self.name,
                &Oid::new(SPNEGO),
                self.delegates.into(),
                u32::MAX,
                bindings.as_ref().map_or(null(), core::ptr::from_ref),
                &Buffer::new(token),
                null_mut(),
                &mut output,
                null_mut(),
                null_mut(),
            )
        };
        if output.value.is_null() {
            return None;
        }
        // SAFETY: the library has allocated it, and it is not used after it is released.
        let next = unsafe {
            let next = core::slice::from_raw_parts(output.value, output.length).to_vec();
            (self.library.release_buffer)(&mut 0, &mut output);
            next
        };
        (status <= CONTINUE_NEEDED).then_some(next)
    }
}

impl Drop for Context {
    fn drop(&mut self) {
        // SAFETY: both are from the library, and are not used any more.
        unsafe {
            if !self.context.is_null() {
                (self.library.delete_context)(&mut 0, &mut self.context, null_mut());
            }
            (self.library.release_name)(&mut 0, &mut self.name);
        }
    }
}
