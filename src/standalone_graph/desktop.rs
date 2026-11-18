//! Where the UI library of `bun:desktop` comes from, and where it is in the bundle that `--desktop` makes.

use bstr::BStr;
use bun_core::Environment::OperatingSystem;
use bun_core::{ZBox, env_var};
use bun_paths::resolve_path::{join_abs_string_spill, platform};

use crate::StandaloneModuleGraph::{CompileError, CompileTarget, download_to_path};

fn library_name(os: OperatingSystem) -> &'static bun_core::ZStr {
    match os {
        OperatingSystem::Mac => bun_core::zstr!("libbun_desktop.dylib"),
        OperatingSystem::Windows => bun_core::zstr!("bun_desktop.dll"),
        _ => bun_core::zstr!("libbun_desktop.so"),
    }
}

fn join(base: &[u8], parts: &[&[u8]]) -> Vec<u8> {
    let mut spill = Vec::new();
    join_abs_string_spill::<platform::Auto>(base, &mut spill, parts).to_vec()
}

/// Paths in a bundle, from the directory of its executable.
pub struct Layout {
    pub library: Vec<u8>,
    pub resources: Vec<u8>,
}

impl Layout {
    pub fn of(os: OperatingSystem, executable: &[u8]) -> Layout {
        let directory = bun_paths::dirname_simple(executable);
        let library = library_name(os).as_bytes();
        match os {
            OperatingSystem::Mac => Layout {
                library: join(directory, &[b"../Frameworks", library]),
                resources: join(directory, &[b"../Resources"]),
            },
            OperatingSystem::Windows => Layout {
                library: join(directory, &[library]),
                resources: join(directory, &[b"resources"]),
            },
            _ => {
                let name = bun_paths::basename(executable);
                Layout {
                    library: join(directory, &[b"../lib", name, library]),
                    resources: join(directory, &[b"../share", name]),
                }
            }
        }
    }

    fn of_this_executable() -> Option<Layout> {
        let executable = bun_core::self_exe_path().ok()?;
        Some(Layout::of(bun_core::Environment::OS, executable.as_bytes()))
    }
}

/// For a compiled program. It loads the library of its bundle and no other: the environment does not choose code for
/// an app that was signed.
pub fn library_in_bundle() -> Option<Vec<u8>> {
    Some(Layout::of_this_executable()?.library).filter(|path| bun_sys::exists(path))
}

pub fn resources_in_bundle() -> Option<Vec<u8>> {
    Some(Layout::of_this_executable()?.resources)
}

/// `BUN_DESKTOP_LIBRARY`, the file beside this executable, or the download for `target` (fetched now if missing).
pub fn library_for(
    target: &CompileTarget,
    env: &bun_dotenv::Loader,
) -> Result<Vec<u8>, CompileError> {
    if let Some(path) = env_var::BUN_DESKTOP_LIBRARY.get_not_empty() {
        if !bun_sys::exists(path) {
            return Err(CompileError::fmt(format_args!(
                "BUN_DESKTOP_LIBRARY names a file that does not exist: {}",
                BStr::new(path)
            )));
        }
        return Ok(path.to_vec());
    }
    let Some((package, version)) = target.desktop_package() else {
        return Err(CompileError::fmt(format_args!(
            "bun:desktop is not available for '{target}'"
        )));
    };
    let name = library_name(target.os);
    if target.is_this_bun()
        && let Ok(executable) = bun_core::self_exe_path()
    {
        let beside = join(
            bun_paths::dirname_simple(executable.as_bytes()),
            &[name.as_bytes()],
        );
        if bun_sys::exists(&beside) {
            return Ok(beside);
        }
    }

    let cached = join(
        bun_paths::fs::FileSystem::instance().top_level_dir(),
        &[
            &bun_sys::fetch_cache_directory_path(),
            format!("{package}-v{version}").as_bytes(),
            name.as_bytes(),
        ],
    );
    if bun_sys::exists(&cached) {
        return Ok(cached);
    }
    let default_url =
        format!("https://registry.npmjs.org/@oven/{package}/-/{package}-{version}.tgz");
    let url = env_var::BUN_DESKTOP_TARBALL_URL
        .get_not_empty()
        .unwrap_or(default_url.as_bytes());
    match download_to_path(url, name, env, &ZBox::from_bytes(&cached)) {
        Ok(()) => Ok(cached),
        Err(error) => Err(CompileError::fmt(format_args!(
            "Failed to download the UI library of bun:desktop from {} ({}). Set BUN_DESKTOP_LIBRARY to use a local {}.",
            BStr::new(url),
            BStr::new(error.name()),
            BStr::new(name.as_bytes()),
        ))),
    }
}
