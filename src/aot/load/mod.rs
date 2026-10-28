pub(crate) mod builtin_uses;
mod bundled_commonjs;
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
pub(crate) mod runtime_types;
#[cfg(test)]
pub mod source_provider;
pub mod sources;
pub(crate) mod test_runner_names;
pub(crate) mod worker_files;

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
    match std::env::consts::OS {
        "macos" => Platforms::DARWIN,
        "windows" => Platforms::WINDOWS,
        "freebsd" => Platforms::FREEBSD,
        "android" => Platforms::ANDROID,
        _ => Platforms::LINUX,
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

#[cfg(test)]
mod tests {
    use super::*;
    use bun_sema_driver::host::from_native;

    #[test]
    fn host_platform_is_one_platform() {
        assert_eq!(host_platform().bits().count_ones(), 1);
    }

    #[test]
    fn builtin_sources_are_under_host_root() {
        assert!(is_host_path(bun_builtin_sources::VIRTUAL_ROOT));
    }

    #[test]
    fn compiler_declarations_are_under_host_root() {
        assert!(is_host_path(compiler_declarations::PATH));
        assert!(!compiler_declarations::PATH.starts_with(bun_builtin_sources::VIRTUAL_ROOT));
    }

    #[test]
    fn node_modules_directory_is_found_on_every_platform() {
        assert!(is_in_node_modules(b"/project/node_modules/p/a.ts"));
        assert!(is_in_node_modules(b"/C:/project/node_modules/p/a.ts"));
        assert!(!is_in_node_modules(b"/project/node_modules/a.ts"));
        assert!(!is_in_node_modules(b"/project/not_node_modules/p/a.ts"));
    }

    #[test]
    #[allow(clippy::disallowed_methods)]
    fn reads_bytes_undecoded() {
        let name = format!("bun_aot_read_file_bytes_{}", std::process::id());
        let file = std::env::temp_dir().join(name);
        let utf16_text = [0xFF, 0xFE, b'a', 0];
        std::fs::write(&file, utf16_text).unwrap();
        let path = from_native(file.as_os_str().as_encoded_bytes());

        let bytes = read_file_bytes(&path);
        let bytes_at_truncated_path = read_file_bytes(&[&path[..], b"\0.ts"].concat());
        std::fs::remove_file(&file).unwrap();

        assert_eq!(bytes.as_deref(), Some(&utf16_text[..]));
        assert_eq!(bytes_at_truncated_path, None);
        assert_eq!(read_file_bytes(&path), None);
    }
}
