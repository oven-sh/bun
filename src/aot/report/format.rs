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
        PathPrinter::in_directory(working_directory)
    }

    pub(super) fn in_directory(working_directory: Vec<u8>) -> PathPrinter {
        PathPrinter { working_directory }
    }

    pub(super) fn write_path(&self, out: &mut Vec<u8>, path: &[u8]) {
        let start = out.len();
        if self.can_relativize(path) {
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

    fn can_relativize(&self, path: &[u8]) -> bool {
        // `relative` fills fixed buffers: at most "../" per directory component, then `path`.
        is_absolute(&self.working_directory)
            && is_absolute(path)
            && 2 * self.working_directory.len() + path.len() < MAX_PATH_BYTES
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
