//! The file system as the checker sees it.
//!
//! The checker's paths are absolute, use `/`, and start with one. On Windows `C:\a\b` is `/C:/a/b` to it.

use bun_sema::atom::Interner;
use bun_sema::hir;
use bun_sema::resolve::{Host, ModuleDetection, Options};
use std::borrow::Cow;

/// Where TypeScript's `lib.*.d.ts` are for a project in `dir`: in the `typescript` package it has installed, which is also what its
/// editor reads them from. TypeScript 7 keeps them in a package for the platform. Last, in what is installed globally.
pub fn find_lib_dir(
    host: &dyn Host,
    dir: &str,
    global_node_modules: Option<&str>,
) -> Option<String> {
    let in_node_modules = |node_modules: &str| -> Option<String> {
        let plain = format!("{node_modules}/typescript/lib");
        if host.is_file(&format!("{plain}/lib.es5.d.ts")) {
            return Some(plain);
        }
        let scope = format!("{node_modules}/@typescript");
        let (_, mut packages) = host.entries(&scope);
        // The package for the platform goes with `typescript` itself. Others may be older versions under another name.
        packages.sort_by_key(|name| {
            !(name.starts_with("typescript-") || name.starts_with("native-preview-"))
        });
        packages
            .into_iter()
            .map(|package| format!("{scope}/{package}/lib"))
            .find(|lib| host.is_file(&format!("{lib}/lib.es5.d.ts")))
    };
    let mut dir = dir;
    loop {
        if let Some(found) = in_node_modules(&bun_sema::resolve::join(dir, "node_modules")) {
            return Some(found);
        }
        let parent = bun_sema::resolve::parent_dir(dir);
        if parent == dir || parent.is_empty() {
            break;
        }
        dir = parent;
    }
    global_node_modules.and_then(in_node_modules)
}

#[cfg(windows)]
pub fn to_native(path: &str) -> String {
    // `/C:/a` is `C:/a`, which Windows takes.
    match path.as_bytes() {
        [b'/', drive, b':', ..] if drive.is_ascii_alphabetic() => path[1..].to_owned(),
        _ => path.to_owned(),
    }
}
#[cfg(not(windows))]
pub fn to_native(path: &str) -> &str {
    path
}

/// A path of the operating system as the checker names it. It has to be absolute.
pub fn from_native(path: &str) -> String {
    #[cfg(windows)]
    {
        let path = path.replace('\\', "/");
        let path = path.strip_prefix("//?/").unwrap_or(&path);
        return bun_sema::resolve::normalize(&format!("/{path}"));
    }
    #[cfg(not(windows))]
    bun_sema::resolve::normalize(path)
}

pub struct Disk<'a> {
    pub threads: usize,
    pub thread_start: &'a (dyn Fn(usize) + Sync),
    case_sensitive: bool,
}

impl<'a> Disk<'a> {
    pub fn new(threads: usize, thread_start: &'a (dyn Fn(usize) + Sync)) -> Self {
        Disk {
            threads,
            thread_start,
            case_sensitive: is_file_system_case_sensitive(),
        }
    }
}

/// `isFileSystemCaseSensitive`: whether this program is still found when the case of its path is swapped.
fn is_file_system_case_sensitive() -> bool {
    if cfg!(windows) {
        return false;
    }
    let Ok(exe) = std::env::current_exe() else {
        return true;
    };
    let swapped: String = exe
        .to_string_lossy()
        .chars()
        .map(|c| {
            if c.is_ascii_uppercase() {
                c.to_ascii_lowercase()
            } else {
                c.to_ascii_uppercase()
            }
        })
        .collect();
    !std::path::Path::new(&swapped).exists()
}

impl Host for Disk<'_> {
    fn read(&self, path: &str) -> Option<Cow<'static, [u8]>> {
        std::fs::read(to_native(path)).ok().map(Cow::Owned)
    }
    fn is_file(&self, path: &str) -> bool {
        std::fs::metadata(to_native(path)).is_ok_and(|m| m.is_file())
    }
    fn is_dir(&self, path: &str) -> bool {
        std::fs::metadata(to_native(path)).is_ok_and(|m| m.is_dir())
    }
    fn realpath(&self, path: &str) -> String {
        std::fs::canonicalize(to_native(path))
            .map_or_else(|_| path.to_owned(), |p| from_native(&p.to_string_lossy()))
    }
    fn list_dir(&self, path: &str) -> Vec<String> {
        let Ok(entries) = std::fs::read_dir(to_native(path)) else {
            return Vec::new();
        };
        entries
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect()
    }
    fn entries(&self, path: &str) -> (Vec<String>, Vec<String>) {
        let (mut files, mut directories) = (Vec::new(), Vec::new());
        let Ok(entries) = std::fs::read_dir(to_native(path)) else {
            return (files, directories);
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            // What the directory says about the entry spares asking about each file. A link has to be followed.
            let is_dir = match entry.file_type() {
                Ok(kind) if kind.is_symlink() => {
                    std::fs::metadata(entry.path()).is_ok_and(|m| m.is_dir())
                }
                Ok(kind) => kind.is_dir(),
                Err(_) => continue,
            };
            if is_dir {
                directories.push(name);
            } else {
                files.push(name);
            }
        }
        files.sort_unstable();
        directories.sort_unstable();
        (files, directories)
    }
    fn is_case_sensitive(&self) -> bool {
        self.case_sensitive
    }
    fn parse(&self, path: &str, text: &[u8], atoms: &Interner, options: &Options) -> hir::File {
        bun_js_parser::sema::summarize(
            path.as_bytes(),
            text,
            atoms,
            options.experimental_decorators,
            options.module_detection == ModuleDetection::Force,
        )
    }
    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        crate::for_each_parallel(self.threads, count, self.thread_start, work);
    }
}
