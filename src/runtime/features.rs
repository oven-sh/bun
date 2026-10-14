//! The doors to the features (`bun_core::feature`), what goes through them, and what of Bun the features use.

use bun_bundler::options::TypeChecked;
use bun_core::{Global, Output, ZStr, feature};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue};
use bun_options_types::context::ContextData;

pub use crate::cli::arguments::disallow_code_generation_from_strings_as_compiled;
pub use crate::cli::command::tag_print_help;
pub use crate::jsc_hooks::{lint_vm, take_lint_vm};
pub use crate::node::os::freemem;

pub fn columns_of_stdout() -> u16 {
    crate::cli::run_command::RunCommand::columns_of_stdout()
}

fn built_without_this_command() -> ! {
    Output::err_generic("this executable was built without this command", ());
    Global::exit(1)
}

/// `--check` and `check: true` are refused in an executable without type checking, so nothing gets as far as this.
fn built_without_type_checking() -> ! {
    Output::err_generic("this executable was built without type checking", ());
    Global::exit(1)
}

pub fn working_directory() -> Vec<u8> {
    let mut buf = bun_paths::path_buffer_pool::get();
    match bun_core::getcwd(&mut buf) {
        Ok(cwd) => cwd.as_bytes().to_vec(),
        Err(err) => {
            Output::err(err, "Could not read the working directory", ());
            Global::exit(1);
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// check
// ───────────────────────────────────────────────────────────────────────────

/// What is run.
#[derive(Clone, Copy)]
pub struct EntryPoint<'a> {
    pub path: &'a [u8],
    /// What it is loaded with. `None`: what its name says.
    pub loader: Option<bun_ast::Loader>,
    /// It is not in a file: `-e`, or what is read from stdin.
    pub text: Option<&'a [u8]>,
}

impl<'a> EntryPoint<'a> {
    pub fn file(path: &'a [u8]) -> EntryPoint<'a> {
        EntryPoint {
            path,
            loader: None,
            text: None,
        }
    }
}

/// Called with the path of a file, in the checker's format, right before the file is read, on the thread that reads it.
pub type BeforeRead = Box<dyn Fn(&[u8]) + Send + Sync>;

/// `bun check <args>`
#[feature::door(check)]
pub fn exec_check(args: &[&ZStr]) -> ! {
    built_without_this_command()
}

/// `bun --check` and `bun run --check` without anything to run.
#[feature::door(check)]
pub fn exec_check_without_arguments() -> ! {
    built_without_type_checking()
}

/// The flags, for `bun check --help`.
#[feature::door(check)]
pub fn print_flags_of_check() {}

/// Type checks `entry_points` and everything they import before they are run. Returns whether they
/// have no errors. Reports the errors on stderr, which leaves stdout to the program.
#[feature::door(check)]
pub fn check_before(entry_points: &[EntryPoint], before_read: Option<BeforeRead>) -> bool {
    built_without_type_checking()
}

/// `before_read` of `check_before` under `--watch`. `None` without a file watcher.
#[feature::door(check)]
pub fn watching(vm: &VirtualMachine) -> Option<BeforeRead> {
    None
}

/// Type checks the project, as `bun check` does, before scripts are run.
#[feature::door(check)]
pub fn check_project_before() -> bool {
    built_without_type_checking()
}

/// `BundleOptions::type_check` for `bun build --check`.
#[feature::door(check)]
pub fn check_for_build_command(checked: TypeChecked, log: &mut bun_ast::Log) -> bool {
    built_without_type_checking()
}

/// `BundleOptions::type_check` for `Bun.build({ check: true })`. It prints nothing.
#[feature::door(check)]
pub fn check_for_bun_build(checked: TypeChecked, log: &mut bun_ast::Log) -> bool {
    built_without_type_checking()
}

/// `process.versions.typescript`. Null without a type checker.
#[feature::door(check, lint, fmt)]
#[unsafe(no_mangle)]
pub extern "C" fn Bun__typescript_version() -> *const core::ffi::c_char {
    core::ptr::null()
}

// ───────────────────────────────────────────────────────────────────────────
// lint
// ───────────────────────────────────────────────────────────────────────────

/// `bun lint <args>`
#[feature::door(lint)]
pub fn exec_lint(ctx: &mut ContextData, args: &[&ZStr]) -> ! {
    built_without_this_command()
}

/// Whether `flag` is one of `bun lint`.
#[feature::door(lint)]
pub fn is_flag_of_lint(flag: &[u8]) -> bool {
    false
}

/// The flags, for `bun lint --help`.
#[feature::door(lint)]
pub fn print_flags_of_lint(all: bool) {}

/// `bun lint` and `bun fmt` run a program in a process of its own, which is this one if they started it.
#[feature::door(lint, fmt)]
pub fn read_program_of_script(ctx: &mut ContextData) {}

/// Bytes that stay the same, and in the same place, until the call that is running is over.
#[repr(C)]
pub struct LintSpan {
    pub ptr: *const u8,
    pub len: usize,
}

/// src/jsc/bindings/LintHost.h
#[feature::door(lint, fmt)]
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Lint__ask(
    global: &JSGlobalObject,
    kind: u32,
    details: *const u8,
    details_len: usize,
) -> LintSpan {
    LintSpan {
        ptr: core::ptr::null(),
        len: 0,
    }
}

// ───────────────────────────────────────────────────────────────────────────
// fmt
// ───────────────────────────────────────────────────────────────────────────

/// `bun fmt <args>`
#[feature::door(fmt)]
pub fn exec_format(ctx: &mut ContextData, args: &[&ZStr]) -> ! {
    built_without_this_command()
}

/// Whether `flag` is one of `bun fmt`.
#[feature::door(fmt)]
pub fn is_flag_of_format(flag: &[u8]) -> bool {
    false
}

/// The flags, for `bun fmt --help`.
#[feature::door(fmt)]
pub fn print_flags_of_format(all: bool) {}

// ───────────────────────────────────────────────────────────────────────────
// Bun.*
// ───────────────────────────────────────────────────────────────────────────

pub use crate::crypto::evp::lookup_ignore_case as lookup_digest_ignore_case;
pub use crate::node::types::Encoding as NodeEncoding;

/// `Bun.semver`
#[feature::door(semver)]
pub fn semver_object(global: &JSGlobalObject) -> JSValue {
    JSValue::UNDEFINED
}

/// `Bun.CSRF`
#[feature::door(csrf)]
pub fn csrf_object(global: &JSGlobalObject) -> JSValue {
    JSValue::UNDEFINED
}
