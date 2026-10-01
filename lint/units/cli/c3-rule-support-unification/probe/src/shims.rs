//! Native symbols that Bun's C++ side provides, written out for this probe binary (precedent:
//! src/parsers/native_test_shims.rs). mimalloc is the real object of the build; every other symbol that
//! the parse of a file can reach is here, with the scalar semantics of the C++ (highway_strings.cpp,
//! bun-simdutf.cpp, wtf-bindings.cpp). What stays undefined is linked with --unresolved-symbols=ignore-all.
#![allow(clippy::missing_safety_doc)]

use core::ffi::c_void;

unsafe extern "C" {
    fn pthread_self() -> usize;
    fn pthread_getattr_np(thread: usize, attr: *mut [u8; 64]) -> i32;
    fn pthread_attr_getstack(attr: *const [u8; 64], addr: *mut *mut c_void, size: *mut usize) -> i32;
    fn pthread_attr_destroy(attr: *mut [u8; 64]) -> i32;
}

#[unsafe(no_mangle)]
extern "C" fn Bun__StackCheck__getMaxStack() -> *mut c_void {
    let mut attr = [0u8; 64];
    let mut addr: *mut c_void = core::ptr::null_mut();
    let mut size: usize = 0;
    unsafe {
        if pthread_getattr_np(pthread_self(), &mut attr) != 0 {
            let probe: u8 = 0;
            return ((&raw const probe) as usize).saturating_sub(512 * 1024) as *mut c_void;
        }
        pthread_attr_getstack(&attr, &mut addr, &mut size);
        pthread_attr_destroy(&mut attr);
    }
    addr
}

#[unsafe(no_mangle)]
extern "C" fn Bun__StackCheck__initialize() {}

unsafe fn bytes<'a>(p: *const u8, n: usize) -> &'a [u8] {
    if n == 0 { &[] } else { unsafe { core::slice::from_raw_parts(p, n) } }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_char(h: *const u8, n: usize, needle: u8) -> usize {
    unsafe { bytes(h, n) }.iter().position(|&c| c == needle).unwrap_or(n)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_last_index_of_char(h: *const u8, n: usize, needle: u8) -> usize {
    unsafe { bytes(h, n) }.iter().rposition(|&c| c == needle).unwrap_or(n)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_not_char(h: *const u8, n: usize, value: u8) -> usize {
    unsafe { bytes(h, n) }.iter().position(|&c| c != value).unwrap_or(n)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_count_char(h: *const u8, n: usize, needle: u8) -> usize {
    unsafe { bytes(h, n) }.iter().filter(|&&c| c == needle).count()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_any_char(t: *const u8, n: usize, chars: *const u8, m: usize) -> usize {
    let (t, cs) = unsafe { (bytes(t, n), bytes(chars, m)) };
    t.iter().position(|c| cs.contains(c)).unwrap_or(n)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_last_index_of_any_char(t: *const u8, n: usize, chars: *const u8, m: usize) -> usize {
    let (t, cs) = unsafe { (bytes(t, n), bytes(chars, m)) };
    t.iter().rposition(|c| cs.contains(c)).unwrap_or(n)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memmem(h: *const u8, hn: usize, nd: *const u8, nn: usize) -> *const u8 {
    let (hs, n) = unsafe { (bytes(h, hn), bytes(nd, nn)) };
    if n.is_empty() {
        return h;
    }
    if hs.len() < n.len() {
        return core::ptr::null();
    }
    match (0..=hs.len() - n.len()).find(|&i| hs[i..i + n.len()] == *n) {
        Some(i) => unsafe { h.add(i) },
        None => core::ptr::null(),
    }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memrmem(h: *const u8, hn: usize, nd: *const u8, nn: usize) -> usize {
    let (hs, n) = unsafe { (bytes(h, hn), bytes(nd, nn)) };
    if n.is_empty() {
        return hs.len();
    }
    if hs.len() < n.len() {
        return usize::MAX;
    }
    (0..=hs.len() - n.len()).rev().find(|&i| hs[i..i + n.len()] == *n).unwrap_or(usize::MAX)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memrmem16(h: *const u16, hn: usize, nd: *const u16, nn: usize) -> usize {
    let (hs, n) = unsafe {
        (
            if hn == 0 { &[][..] } else { core::slice::from_raw_parts(h, hn) },
            if nn == 0 { &[][..] } else { core::slice::from_raw_parts(nd, nn) },
        )
    };
    if n.is_empty() {
        return hs.len();
    }
    if hs.len() < n.len() {
        return usize::MAX;
    }
    (0..=hs.len() - n.len()).rev().find(|&i| hs[i..i + n.len()] == *n).unwrap_or(usize::MAX)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_interesting_character_in_string_literal(t: *const u8, n: usize, quote: u8) -> usize {
    unsafe { bytes(t, n) }.iter().position(|&c| c == quote || c == b'\\' || c < 0x20 || c > 0x7E).unwrap_or(n)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_interesting_character_in_multiline_comment(t: *const u8, n: usize) -> usize {
    unsafe { bytes(t, n) }.iter().position(|&c| c == b'*' || c == b'\r' || c == b'\n' || c > 127).unwrap_or(n)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_newline_or_non_ascii(t: *const u8, n: usize) -> usize {
    unsafe { bytes(t, n) }.iter().position(|&c| c > 127 || c < 0x20).unwrap_or(n)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_newline_or_non_ascii_or_hash_or_at(t: *const u8, n: usize) -> usize {
    unsafe { bytes(t, n) }.iter().position(|&c| c == b'#' || c == b'@' || c < 0x20 || c > 127).unwrap_or(n)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_space_or_newline_or_non_ascii(t: *const u8, n: usize) -> usize {
    unsafe { bytes(t, n) }.iter().position(|&c| c <= b' ' || c > 127).unwrap_or(n)
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_contains_newline_or_non_ascii_or_quote(t: *const u8, n: usize) -> bool {
    unsafe { bytes(t, n) }.iter().any(|&c| c > 127 || c < 0x20 || c == b'"')
}
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_needs_escape_for_javascript_string(t: *const u8, n: usize, quote: u8) -> usize {
    unsafe { bytes(t, n) }
        .iter()
        .position(|&c| c >= 127 || c < 0x20 || c == b'\\' || c == quote || (quote == b'`' && c == b'$'))
        .unwrap_or(n)
}

#[repr(C)]
struct SimdutfResult {
    status: i32,
    count: usize,
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_ascii(p: *const u8, n: usize) -> bool {
    unsafe { bytes(p, n) }.is_ascii()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_ascii_with_errors(p: *const u8, n: usize) -> SimdutfResult {
    match unsafe { bytes(p, n) }.iter().position(|&c| c > 127) {
        Some(i) => SimdutfResult { status: 8, count: i },
        None => SimdutfResult { status: 0, count: n },
    }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_utf8(p: *const u8, n: usize) -> bool {
    core::str::from_utf8(unsafe { bytes(p, n) }).is_ok()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_utf8_with_errors(p: *const u8, n: usize) -> SimdutfResult {
    match core::str::from_utf8(unsafe { bytes(p, n) }) {
        Ok(_) => SimdutfResult { status: 0, count: n },
        Err(e) => SimdutfResult { status: 1, count: e.valid_up_to() },
    }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf16_length_from_utf8(p: *const u8, n: usize) -> usize {
    // simdutf counts one unit per lead byte and one more per four-byte lead.
    unsafe { bytes(p, n) }.iter().map(|&c| (c & 0xC0 != 0x80) as usize + (c >= 0xF0) as usize).sum()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf8_length_from_latin1(p: *const u8, n: usize) -> usize {
    unsafe { bytes(p, n) }.iter().map(|&c| 1 + (c > 127) as usize).sum()
}
unsafe fn units<'a>(p: *const u16, n: usize) -> &'a [u16] {
    if n == 0 { &[] } else { unsafe { core::slice::from_raw_parts(p, n) } }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf8_length_from_utf16le(p: *const u16, n: usize) -> usize {
    unsafe { units(p, n) }
        .iter()
        .map(|&u| if u < 0x80 { 1 } else if u < 0x800 { 2 } else if (0xD800..0xE000).contains(&u) { 2 } else { 3 })
        .sum()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf8_length_from_utf16le_with_replacement(p: *const u16, n: usize) -> usize {
    char::decode_utf16(unsafe { units(p, n) }.iter().copied()).map(|r| r.map_or(3, char::len_utf8)).sum()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_utf16le(p: *const u16, n: usize) -> bool {
    char::decode_utf16(unsafe { units(p, n) }.iter().copied()).all(|r| r.is_ok())
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__convert_utf16le_to_utf8_with_errors(p: *const u16, n: usize, out: *mut u8) -> SimdutfResult {
    let input = unsafe { units(p, n) };
    let (mut i, mut written) = (0usize, 0usize);
    while i < input.len() {
        let u = input[i];
        let (cp, step) = if (0xD800..0xDC00).contains(&u) {
            match input.get(i + 1) {
                Some(&lo) if (0xDC00..0xE000).contains(&lo) => (0x10000 + (((u as u32) - 0xD800) << 10) + ((lo as u32) - 0xDC00), 2),
                _ => return SimdutfResult { status: 6, count: i },
            }
        } else if (0xDC00..0xE000).contains(&u) {
            return SimdutfResult { status: 6, count: i };
        } else {
            (u as u32, 1)
        };
        let ch = char::from_u32(cp).unwrap_or('\u{FFFD}');
        let mut buf = [0u8; 4];
        let s = ch.encode_utf8(&mut buf);
        unsafe { core::ptr::copy_nonoverlapping(s.as_ptr(), out.add(written), s.len()) };
        written += s.len();
        i += step;
    }
    SimdutfResult { status: 0, count: written }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__convert_valid_utf16le_to_utf8(p: *const u16, n: usize, out: *mut u8) -> usize {
    unsafe { simdutf__convert_utf16le_to_utf8_with_errors(p, n, out) }.count
}
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__convert_utf8_to_utf16le_with_errors(p: *const u8, n: usize, out: *mut u16) -> SimdutfResult {
    let input = unsafe { bytes(p, n) };
    match core::str::from_utf8(input) {
        Ok(s) => {
            let mut written = 0usize;
            for u in s.encode_utf16() {
                unsafe { *out.add(written) = u };
                written += 1;
            }
            SimdutfResult { status: 0, count: written }
        }
        Err(e) => {
            let valid = unsafe { core::str::from_utf8_unchecked(&input[..e.valid_up_to()]) };
            let mut written = 0usize;
            for u in valid.encode_utf16() {
                unsafe { *out.add(written) = u };
                written += 1;
            }
            SimdutfResult { status: if e.error_len().is_none() { 2 } else { 1 }, count: e.valid_up_to() }
        }
    }
}

/// The longest prefix that is a decimal literal, parsed with correct rounding; `counted` is its length.
#[unsafe(no_mangle)]
unsafe extern "C" fn WTF__parseDouble(p: *const u8, n: usize, counted: *mut usize) -> f64 {
    let s = unsafe { bytes(p, n) };
    let mut i = 0;
    if i < s.len() && (s[i] == b'+' || s[i] == b'-') {
        i += 1;
    }
    let int_start = i;
    while i < s.len() && s[i].is_ascii_digit() {
        i += 1;
    }
    let mut digits = i - int_start;
    if i < s.len() && s[i] == b'.' {
        let mut j = i + 1;
        while j < s.len() && s[j].is_ascii_digit() {
            j += 1;
        }
        digits += j - (i + 1);
        if digits > 0 {
            i = j;
        }
    }
    if digits == 0 {
        unsafe { *counted = 0 };
        return 0.0;
    }
    if i < s.len() && (s[i] == b'e' || s[i] == b'E') {
        let mut j = i + 1;
        if j < s.len() && (s[j] == b'+' || s[j] == b'-') {
            j += 1;
        }
        let exp_start = j;
        while j < s.len() && s[j].is_ascii_digit() {
            j += 1;
        }
        if j > exp_start {
            i = j;
        }
    }
    unsafe { *counted = i };
    let text = core::str::from_utf8(&s[..i]).unwrap_or("0");
    let text = text.strip_suffix('.').unwrap_or(text);
    text.parse::<f64>().unwrap_or(f64::NAN)
}

/// Number::toString(10) of ECMAScript, from the shortest digits that round-trip.
#[unsafe(no_mangle)]
extern "C" fn WTF__dtoa(buf: &mut [u8; 124], number: f64) -> usize {
    let text = js_number_to_string(number);
    buf[..text.len()].copy_from_slice(text.as_bytes());
    text.len()
}

pub fn js_number_to_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x == 0.0 {
        return "0".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    let sci = format!("{:e}", x.abs());
    let (mantissa, exp) = sci.split_once('e').unwrap();
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n = exp.parse::<i32>().unwrap() + 1;
    let mut out = String::new();
    if x < 0.0 {
        out.push('-');
    }
    if k <= n && n <= 21 {
        out.push_str(&digits);
        for _ in 0..(n - k) {
            out.push('0');
        }
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        for _ in 0..(-n) {
            out.push('0');
        }
        out.push_str(&digits);
    } else {
        let e = n - 1;
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        out.push(if e < 0 { '-' } else { '+' });
        out.push_str(&e.abs().to_string());
    }
    out
}

macro_rules! never_called {
    ($($name:ident),* $(,)?) => {$(
        #[unsafe(no_mangle)]
        extern "C" fn $name() -> ! {
            eprintln!(concat!("probe: ", stringify!($name), " has no shim"));
            std::process::abort()
        }
    )*};
}
never_called!(
    WTF__DumpStackTrace,
    __bun_macro_context_get_remap,
    __bun_macro_context_call,
    bun_restore_stdio,
    compress2,
    is_executable_file,
    on_before_reload_process_posix,
    posix_spawn_bun,
    simdutf__base64_encode,
);

#[unsafe(no_mangle)]
extern "C" fn bun_cpu_features() -> u8 {
    0
}
