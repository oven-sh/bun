use bun_core::fmt::{ItoaBuf, itoa};
use bun_paths::resolve_path::{platform_to_posix_in_place, relative};
use bun_paths::{MAX_PATH_BYTES, is_absolute};

pub(super) struct PathPrinter {
    working_directory: Vec<u8>,
}

impl PathPrinter {
    pub(super) fn new() -> PathPrinter {
        let mut buffer = bun_paths::path_buffer_pool::get();
        let working_directory = match bun_core::getcwd(&mut buffer) {
            Ok(directory) => directory.as_bytes().to_vec(),
            Err(_) => Vec::new(),
        };
        PathPrinter { working_directory }
    }

    pub(super) fn write_path(&self, out: &mut Vec<u8>, path: &[u8]) {
        let start = out.len();
        // `relative` fills fixed buffers: at most "../" per directory component, then `path`.
        let can_relativize = is_absolute(&self.working_directory)
            && is_absolute(path)
            && 2 * self.working_directory.len() + path.len() < MAX_PATH_BYTES;
        if can_relativize {
            out.extend_from_slice(relative(&self.working_directory, path));
        }
        if out.len() == start {
            out.extend_from_slice(path);
        }
    }

    pub(super) fn posix_path(&self, path: &[u8]) -> Vec<u8> {
        let mut shown = Vec::new();
        self.write_path(&mut shown, path);
        platform_to_posix_in_place(&mut shown[..]);
        shown
    }
}

pub(super) fn write_parts(out: &mut Vec<u8>, parts: &[&[u8]]) {
    for part in parts {
        out.extend_from_slice(part);
    }
}

fn write_decimal(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(itoa(&mut ItoaBuf::new(), value));
}

pub(super) fn write_count(out: &mut Vec<u8>, count: u64) {
    let mut buffer = ItoaBuf::new();
    let digits = itoa(&mut buffer, count);
    for (index, &digit) in digits.iter().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(b',');
        }
        out.push(digit);
    }
}

pub(super) fn write_counted(out: &mut Vec<u8>, count: u64, one: &str, many: &str) {
    write_count(out, count);
    out.push(b' ');
    out.extend_from_slice(if count == 1 { one } else { many }.as_bytes());
}

pub(super) fn percent_tenths(part: u64, whole: u64) -> u32 {
    if whole == 0 {
        return 1000;
    }
    let tenths = u128::from(part) * 1000 / u128::from(whole);
    (tenths.min(1000) as u32).max(u32::from(part > 0))
}

pub(super) fn write_percent(out: &mut Vec<u8>, tenths: u32) {
    write_decimal(out, tenths / 10);
    if !tenths.is_multiple_of(10) {
        out.push(b'.');
        write_decimal(out, tenths % 10);
    }
    out.push(b'%');
}

pub(super) fn write_code(out: &mut Vec<u8>, member_name: &str) {
    let name = member_name.as_bytes();
    for (index, &byte) in name.iter().enumerate() {
        if index > 0 && byte.is_ascii_uppercase() {
            let follows_uppercase = name[index - 1].is_ascii_uppercase();
            let precedes_lowercase = name.get(index + 1).is_some_and(u8::is_ascii_lowercase);
            if !follows_uppercase || precedes_lowercase {
                out.push(b'-');
            }
        }
        out.push(byte.to_ascii_lowercase());
    }
}

pub(super) fn code_of(member_name: &str) -> Vec<u8> {
    let mut code = Vec::new();
    write_code(&mut code, member_name);
    code
}

pub(super) fn lower_camel_case(member_name: &str) -> Vec<u8> {
    let mut name = member_name.as_bytes().to_vec();
    if let Some(first) = name.first_mut() {
        first.make_ascii_lowercase();
    }
    name
}

#[cfg(test)]
mod tests {
    use bstr::BString;
    use bun_sema_standalone as _;

    use super::*;

    impl PathPrinter {
        pub(in crate::report) fn in_directory(working_directory: Vec<u8>) -> PathPrinter {
            PathPrinter { working_directory }
        }
    }

    fn written(write: impl FnOnce(&mut Vec<u8>)) -> BString {
        let mut out = Vec::new();
        write(&mut out);
        BString::from(out)
    }

    fn native(path: &str) -> Vec<u8> {
        let to_native = |byte| if byte == b'/' { bun_paths::SEP } else { byte };
        path.bytes().map(to_native).collect()
    }

    fn path_from(directory: &str, path: &str) -> BString {
        let printer = PathPrinter::in_directory(native(directory));
        written(|out| printer.write_path(out, &native(path)))
    }

    #[test]
    fn count_groups_digits() {
        let count = |count| written(|out| write_count(out, count));
        assert_eq!(count(0), "0");
        assert_eq!(count(999), "999");
        assert_eq!(count(1000), "1,000");
        assert_eq!(count(123_456), "123,456");
        assert_eq!(count(1_234_567), "1,234,567");
        assert_eq!(count(u64::MAX), "18,446,744,073,709,551,615");
    }

    #[test]
    fn count_of_one_is_singular() {
        let counted = |count| written(|out| write_counted(out, count, "cause", "causes"));
        assert_eq!(counted(0), "0 causes");
        assert_eq!(counted(1), "1 cause");
        assert_eq!(counted(2), "2 causes");
        assert_eq!(counted(1204), "1,204 causes");
    }

    #[test]
    fn percent_tenths_round_down() {
        assert_eq!(percent_tenths(6, 8), 750);
        assert_eq!(percent_tenths(1204, 1303), 924);
        assert_eq!(percent_tenths(0, 8), 0);
        assert_eq!(percent_tenths(8, 8), 1000);
        assert_eq!(percent_tenths(u64::MAX, u64::MAX), 1000);
        assert_eq!(percent_tenths(u64::MAX - 1, u64::MAX), 999);
    }

    #[test]
    fn zero_of_zero_is_100_percent() {
        assert_eq!(percent_tenths(0, 0), 1000);
    }

    #[test]
    fn rounding_never_reaches_extremes() {
        assert_eq!(percent_tenths(999_999, 1_000_000), 999);
        assert_eq!(percent_tenths(1, 1_000_000), 1);
        assert_eq!(percent_tenths(1, u64::MAX), 1);
    }

    #[test]
    fn percent_tenths_stay_in_range() {
        assert_eq!(percent_tenths(9, 8), 1000);
    }

    #[test]
    fn percent_omits_zero_decimal() {
        let percent = |tenths| written(|out| write_percent(out, tenths));
        assert_eq!(percent(750), "75%");
        assert_eq!(percent(924), "92.4%");
        assert_eq!(percent(1000), "100%");
        assert_eq!(percent(0), "0%");
        assert_eq!(percent(1), "0.1%");
    }

    #[test]
    fn codes_are_kebab_case() {
        let code = |member_name| written(|out| write_code(out, member_name));
        assert_eq!(code("UnknownObject"), "unknown-object");
        assert_eq!(code("Unknown"), "unknown");
        assert_eq!(code("RegExpWithoutCode"), "reg-exp-without-code");
        assert_eq!(code(""), "");
    }

    #[test]
    fn acronym_is_one_word_of_code() {
        let code = |member_name| written(|out| write_code(out, member_name));
        assert_eq!(code("WasmUnsupportedCPU"), "wasm-unsupported-cpu");
        assert_eq!(code("WasmHasGCTypes"), "wasm-has-gc-types");
        assert_eq!(code("CPU"), "cpu");
        assert_eq!(code("Int32Overflow"), "int32-overflow");
    }

    #[test]
    fn path_under_directory_is_relative() {
        assert_eq!(path_from("/p/app", "/p/app/a.ts"), native("a.ts"));
        assert_eq!(path_from("/p/app", "/p/app/src/a.ts"), native("src/a.ts"));
    }

    #[test]
    fn sibling_path_uses_parent_segments() {
        assert_eq!(path_from("/p/app", "/p/lib/b.ts"), native("../lib/b.ts"));
        assert_eq!(path_from("/p/app", "/p/apps/b.ts"), native("../apps/b.ts"));
        assert_eq!(path_from("/p/app/src", "/p/b.ts"), native("../../b.ts"));
    }

    #[test]
    fn working_directory_path_is_unchanged() {
        assert_eq!(path_from("/p/app", "/p/app"), native("/p/app"));
    }

    #[test]
    fn path_without_root_is_unchanged() {
        assert_eq!(path_from("/p/app", "node:fs"), "node:fs");
        assert_eq!(path_from("/p/app", "src/a.ts"), native("src/a.ts"));
    }

    #[test]
    fn path_is_unchanged_without_directory() {
        assert_eq!(path_from("", "/p/app/a.ts"), native("/p/app/a.ts"));
    }

    #[test]
    fn oversized_path_is_unchanged() {
        let printer = PathPrinter::in_directory(native("/p"));
        let mut path = native("/p/");
        path.resize(MAX_PATH_BYTES, b'a');
        assert_eq!(written(|out| printer.write_path(out, &path)), path);
    }

    #[test]
    fn new_printer_is_in_working_directory() {
        let path = std::env::current_dir().unwrap().join("a.ts");
        let path = path.as_os_str().as_encoded_bytes();
        assert_eq!(
            written(|out| PathPrinter::new().write_path(out, path)),
            "a.ts"
        );
    }

    #[test]
    fn member_names_in_both_spellings() {
        assert_eq!(
            BString::from(code_of("UnknownKeyStore")),
            "unknown-key-store"
        );
        assert_eq!(
            BString::from(lower_camel_case("CompileTime")),
            "compileTime"
        );
        assert_eq!(BString::from(lower_camel_case("Heap")), "heap");
        assert_eq!(BString::from(lower_camel_case("")), "");
    }

    #[test]
    fn posix_path_has_forward_slashes() {
        let printer = PathPrinter::in_directory(native("/p/app"));
        assert_eq!(
            BString::from(printer.posix_path(&native("/p/app/src/a.ts"))),
            "src/a.ts"
        );
        assert_eq!(BString::from(printer.posix_path(b"node:fs")), "node:fs");
    }
}
