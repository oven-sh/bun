//! For what runs without Bun: properties of characters and breaks from the ICU of the system, and nothing else.

use std::cell::OnceCell;
use std::ffi::{CStr, CString, c_char, c_void};
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
        script_name: transmute::<*mut c_void, extern "C" fn(i32) -> &'static [u8; 4]>(symbol(
            "uscript_getShortName",
        )),
        normalizer: transmute::<*mut c_void, extern "C" fn(&mut i32) -> usize>(symbol(
            "unorm2_getNFCInstance",
        ))(&mut 0),
        decompose: transmute::<
            *mut c_void,
            extern "C" fn(usize, u32, &mut [u16; 4], i32, &mut i32) -> i32,
        >(symbol("unorm2_getRawDecomposition")),
        compose: transmute::<*mut c_void, extern "C" fn(usize, u32, u32) -> i32>(symbol(
            "unorm2_composePair",
        )),
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

type Open = extern "C" fn(i32, *const c_char, *const u16, i32, &mut i32) -> usize;

unsafe extern "C" fn find_breaks(
    kind: u8,
    text: *const u8,
    len: usize,
    offsets: *mut u32,
) -> usize {
    const KINDS: [(i32, &CStr); 7] = [
        (0, c"en"),
        (2, c"en@lb=normal"),
        (2, c"en@lb=loose"),
        (2, c"en@lb=strict"),
        (2, c"zh@lb=normal"),
        (2, c"zh@lb=loose"),
        (2, c"zh@lb=strict"),
    ];
    thread_local! {
        static ITERATORS: [OnceCell<usize>; 7] = Default::default();
    }
    // SAFETY: these are their signatures, and the caller keeps to the contract of `Host`.
    unsafe {
        let text = str::from_utf8_unchecked(std::slice::from_raw_parts(text, len));
        let (units, (of, locale)) = (
            text.encode_utf16().collect::<Vec<_>>(),
            KINDS[usize::from(kind)],
        );
        let open = || {
            transmute::<*mut c_void, Open>(symbol("ubrk_open"))(
                of,
                locale.as_ptr(),
                std::ptr::null(),
                0,
                &mut 0,
            )
        };
        let iterator = ITERATORS.with(|it| *it[usize::from(kind)].get_or_init(open));
        transmute::<*mut c_void, extern "C" fn(usize, *const u16, i32, &mut i32)>(symbol(
            "ubrk_setText",
        ))(iterator, units.as_ptr(), units.len() as i32, &mut 0);
        let next = transmute::<*mut c_void, extern "C" fn(usize) -> i32>(symbol("ubrk_next"));
        let ends: Vec<_> = text
            .char_indices()
            .flat_map(|(at, it)| std::iter::repeat_n(at + it.len_utf8(), it.len_utf16()))
            .collect();
        let found = std::iter::from_fn(|| usize::try_from(next(iterator)).ok()).enumerate();
        found
            .map(|(index, it)| offsets.add(index).write(ends[it - 1] as u32))
            .count()
    }
}

extern "C" fn missing() {
    std::process::abort();
}

static HOST: LazyLock<Host> = LazyLock::new(|| {
    // SAFETY: `Host` only has pointers to functions, `missing` does not return, and the others have these signatures.
    unsafe {
        let nothing: Host =
            transmute([missing as extern "C" fn(); size_of::<Host>() / size_of::<usize>()]);
        let character_property: extern "C" fn(u32, u32) -> i32 =
            transmute(symbol("u_getIntPropertyValue"));
        let mirror: extern "C" fn(u32) -> u32 = transmute(symbol("u_charMirror"));
        Host {
            character_property,
            mirror,
            script_of,
            decompose,
            compose,
            find_breaks,
            ..nothing
        }
    }
});

pub fn install() {
    bun_desktop_set_host(&HOST);
}
