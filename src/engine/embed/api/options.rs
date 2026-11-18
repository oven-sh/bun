use core::ffi::c_void;

use bun_core::strings;
use bun_engine_inspector::profiling::set_jit_dump_directory;
use bun_engine_macros::export;
use bun_engine_vm::{Options, options, parse_flag, parse_number, set_options};

const IGNORED: &[u8] = include_bytes!("../ignored_options.txt");

/// Another name, the name, and whether the two mean the opposite.
const ALIASES: [(&[u8], &[u8], bool); 6] = [
    (b"alwaysDoFullCollection", b"useGenerationalGC", true),
    (b"disableGC", b"useGC", true),
    (b"enableConcurrentJIT", b"useConcurrentJIT", false),
    (
        b"enableControlFlowProfiler",
        b"useControlFlowProfiler",
        false,
    ),
    (b"enableTailCalls", b"useTailCalls", false),
    (b"showDisassembly", b"dumpDisassembly", false),
];

fn set_by_alias(options: &mut Options, name: &[u8], value: &[u8]) -> bool {
    let alias = ALIASES.iter().find(|it| it.0.eq_ignore_ascii_case(name));
    let (Some(&(_, name, is_opposite)), Some(value)) = (alias, parse_flag(value)) else {
        return false;
    };
    options.set(name, if value != is_opposite { b"1" } else { b"0" })
}

fn set_by_log_level(options: &mut Options, name: &[u8], level: &[u8]) -> bool {
    const LEVELS: [&[u8]; 4] = [b"none", b"basic", b"verbose", b"2"];
    let level = LEVELS.iter().position(|it| it.eq_ignore_ascii_case(level));
    level.is_some_and(|level| {
        name.eq_ignore_ascii_case(b"logGC")
            && options.set(name, if level > 0 { b"1" } else { b"0" })
    })
}

fn set_text(name: &[u8], value: &[u8]) -> bool {
    let is_directory = name.eq_ignore_ascii_case(b"jitDumpDirectory");
    if is_directory && !value.is_empty() {
        set_jit_dump_directory(value);
    }
    is_directory
}

fn is_ignored(name: &[u8], value: &[u8]) -> bool {
    let kind = strings::split(IGNORED, b"\n")
        .filter_map(|line| strings::split_once_char(line, b' '))
        .find_map(|(kind, it)| it.eq_ignore_ascii_case(name).then_some(kind));
    match kind {
        Some(b"flag") => parse_flag(value).is_some(),
        Some(b"number") => parse_number(value).is_some(),
        Some(_) => true,
        None => false,
    }
}

/// The size is what the generated header says.
#[export]
unsafe fn options_initialize(options: *mut Options, size: usize) {
    assert!(size == size_of::<Options>());
    // SAFETY: there is room for it.
    unsafe { options.write(Options::default()) };
}

/// `name=value`. False if that is not understood.
#[export]
fn options_set(options: &mut Options, assignment: &[u8]) -> bool {
    strings::split_once_char(assignment, b'=').is_some_and(|(name, value)| {
        options.set(name, value)
            || set_by_alias(options, name, value)
            || set_by_log_level(options, name, value)
            || set_text(name, value)
            || is_ignored(name, value)
    })
}

#[export]
fn options_dump(options: &Options, only_set: bool) {
    options.log(only_set);
}

/// They take effect, and C++ sees with which values.
#[export]
fn options_freeze(values: &mut Options) {
    set_options(values.clone());
    values.clone_from(options());
}

#[export]
fn executable_memory_start() -> usize {
    bun_engine_exec_memory::address_range().start
}

/// Only Windows has them.
#[export]
fn executable_memory_set_exception_handler(
    handler: unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void, *mut c_void) -> i32,
) {
    #[cfg(windows)]
    bun_engine_exec_memory::describe_frames(handler);
    #[cfg(not(windows))]
    let _ = handler;
}
