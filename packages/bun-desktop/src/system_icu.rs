//! For what runs without Bun: properties of characters from the ICU of the system, and nothing else.

use std::ffi::{CString, c_void};
use std::mem::transmute;
use std::sync::LazyLock;

use crate::bun::{abi::Host, bun_desktop_set_host};

fn symbol(name: &str) -> *mut c_void {
    static LIBRARY: LazyLock<(usize, String)> = LazyLock::new(|| {
        let versions = (60..100)
            .rev()
            .map(|it| (format!("libicuuc.so.{it}"), format!("_{it}")));
        let names = std::iter::once(("libicucore.dylib".to_owned(), String::new())).chain(versions);
        // SAFETY: a C string.
        let open = |name: String| {
            unsafe { libc::dlopen(CString::new(name).unwrap().as_ptr(), libc::RTLD_NOW) }
                .expose_provenance()
        };
        names
            .map(|(name, suffix)| (open(name), suffix))
            .find(|it| it.0 != 0)
            .expect("ICU is installed")
    });
    let name = CString::new(format!("{name}{}", LIBRARY.1)).unwrap();
    // SAFETY: a handle and a C string.
    unsafe {
        libc::dlsym(
            std::ptr::with_exposed_provenance_mut(LIBRARY.0),
            name.as_ptr(),
        )
    }
}

struct Functions {
    script_name: extern "C" fn(i32) -> &'static [u8; 4],
    normalizer: usize,
    decompose: extern "C" fn(usize, u32, &mut [u16; 4], i32, &mut i32) -> i32,
    compose: extern "C" fn(usize, u32, u32) -> i32,
}

// SAFETY: these are their signatures.
static ICU: LazyLock<Functions> = LazyLock::new(|| unsafe {
    Functions {
        script_name: transmute(symbol("uscript_getShortName")),
        normalizer: transmute::<*mut c_void, extern "C" fn(&mut i32) -> usize>(symbol(
            "unorm2_getNFCInstance",
        ))(&mut 0),
        decompose: transmute(symbol("unorm2_getRawDecomposition")),
        compose: transmute(symbol("unorm2_composePair")),
    }
});

extern "C" fn script_of(character: u32) -> u32 {
    u32::from_be_bytes(*(ICU.script_name)((HOST.character_property)(
        character, 0x100a,
    )))
}

extern "C" fn decompose(character: u32) -> u64 {
    let mut units = [0; 4];
    let len = (ICU.decompose)(ICU.normalizer, character, &mut units, 4, &mut 0).max(0) as usize;
    char::decode_utf16(units[..len].iter().copied())
        .flatten()
        .zip([0, 32])
        .fold(0, |all, (it, shift)| all | u64::from(it) << shift)
}

extern "C" fn compose(first: u32, second: u32) -> u32 {
    (ICU.compose)(ICU.normalizer, first, second).max(0) as u32
}

extern "C" fn missing() {
    std::process::abort();
}

static HOST: LazyLock<Host> = LazyLock::new(|| {
    // SAFETY: `Host` only has pointers to functions, `missing` does not return, and the others have these signatures.
    unsafe {
        let nothing: Host =
            transmute([missing as extern "C" fn(); size_of::<Host>() / size_of::<usize>()]);
        let (character_property, mirror) = (
            transmute(symbol("u_getIntPropertyValue")),
            transmute(symbol("u_charMirror")),
        );
        Host {
            character_property,
            mirror,
            script_of,
            decompose,
            compose,
            ..nothing
        }
    }
});

pub fn install() {
    bun_desktop_set_host(&HOST);
}
