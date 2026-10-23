pub(crate) mod builtin_uses;
pub(crate) mod compiler_declarations;
pub(crate) mod data_modules;
pub(crate) mod disk_delegation;
pub(crate) mod evaluated_texts;
pub(crate) mod externals;
pub(crate) mod fold_inputs;
pub(crate) mod host;
pub(crate) mod loader_aliases;
pub(crate) mod loaders;
pub(crate) mod locked_builtin_defines;
pub(crate) mod macros;
pub(crate) mod module_paths;
pub(crate) mod named_loads;
pub(crate) mod plugin_modules;
pub mod project;
pub(crate) mod react_compiler;
pub(crate) mod runtime_declarations;
pub(crate) mod runtime_host;
pub(crate) mod runtime_modules;
pub(crate) mod runtime_roots;
#[cfg(test)]
pub mod source_provider;
pub mod sources;
pub(crate) mod test_runner_names;
pub(crate) mod typed_packages;

#[cfg(not(test))]
pub use bun_aot_interface::load::source_provider;

pub use project::{PerProject, ProgramFile, ProjectId};
pub use sources::{EntryPoint, EntryPointKind, ModulePaths, SourceKind, Sources};

use crate::builtins::Platforms;
use bun_core::strings::{contains, contains_char};
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema_driver::host::to_native;
use bun_sys::{Fd, File};

pub(crate) const HOST_ROOT: &[u8] = b"/$bun/";

pub fn host_platform() -> Platforms {
    if cfg!(target_os = "macos") {
        Platforms::DARWIN
    } else if cfg!(target_os = "windows") {
        Platforms::WINDOWS
    } else if cfg!(target_os = "freebsd") {
        Platforms::FREEBSD
    } else if cfg!(target_os = "android") {
        Platforms::ANDROID
    } else {
        Platforms::LINUX
    }
}

pub(crate) fn is_host_path(path: &[u8]) -> bool {
    path.starts_with(HOST_ROOT)
}

pub(crate) fn is_in_node_modules(path: &[u8]) -> bool {
    contains(dirname::<Posix>(path), b"/node_modules/")
}

pub(crate) fn read_file_bytes(path: &[u8]) -> Option<Vec<u8>> {
    let native_path = to_native(path);
    if contains_char(native_path, 0) {
        return None;
    }
    File::read_from(Fd::cwd(), native_path).ok()
}
