//! `bun pm cache pack <file>` / `bun pm cache unpack <file>` — a single-file,
//! uncompressed snapshot of exactly the cache entries the current lockfile
//! needs.
//!
//! CI caches backed by object storage are dramatically faster at moving
//! one large sequential file than tens of thousands of small ones, and the
//! restore side of a directory cache pays a create+write per file *before*
//! `bun install` even starts. With a pack, CI restores one file, `unpack`
//! recreates only the missing cache folders (sequential reads, one rename per
//! package), and `bun install --frozen-lockfile` then finds every tarball
//! already extracted in the cache.
//!
//! Format (little endian, no compression — outer layers already zstd):
//!   magic "BUNCACHEPACK\0v1\n"
//!   repeated:  u8 kind | u32 path_len | path | u32 mode | u64 size | bytes
//!     kind 1 = package folder start (path = cache folder name; size = 0)
//!     kind 2 = regular file (path relative to the current folder)
//!     kind 3 = symlink (bytes = link target)
//!     kind 4 = directory (explicit, for empty dirs)
//!     kind 0 = end of pack

use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use crate::PackageManager;
use crate::lockfile_real::package::PackageColumns as _;
use crate::package_manager_real::directories;
use crate::resolution_real::Tag as ResolutionTag;

const MAGIC: &[u8] = b"BUNCACHEPACK\0v1\n";

pub struct PackSummary {
    pub packages: u32,
    pub files: u64,
    pub bytes: u64,
    pub skipped_missing: u32,
}

pub struct UnpackSummary {
    pub packages: u32,
    pub created: u32,
    pub already_present: u32,
    pub bytes: u64,
}

fn s(p: &[u8]) -> &str {
    // cache folder names and package-relative paths are ASCII/UTF-8 by construction
    unsafe { std::str::from_utf8_unchecked(p) }
}

/// The cache folder name for every fetchable package in the lockfile, and whether
/// the package is expected on this platform (os/cpu/libc) — used only to decide
/// whether a missing folder deserves a warning.
pub fn cache_folder_names(pm: &mut PackageManager) -> Vec<(Vec<u8>, bool)> {
    let mut out: Vec<(Vec<u8>, bool)> = Vec::new();
    let count = pm.lockfile.packages.len();
    for i in 0..count {
        let (name, resolution, expected) = {
            let pkgs = &pm.lockfile.packages;
            let meta = &pkgs.items_meta()[i];
            (
                pkgs.items_name()[i],
                pkgs.items_resolution()[i],
                !meta.is_disabled(pm.options.cpu, pm.options.os),
            )
        };
        let folder: Option<Vec<u8>> = match resolution.tag {
            ResolutionTag::Npm => {
                let name = pm.lockfile.str(&name).to_vec();
                Some(
                    directories::cached_npm_package_folder_name(
                        pm,
                        &name,
                        resolution.npm().version,
                        None,
                    )
                    .as_bytes()
                    .to_vec(),
                )
            }
            ResolutionTag::Git => Some(
                directories::cached_git_folder_name(pm, resolution.git(), None)
                    .as_bytes()
                    .to_vec(),
            ),
            ResolutionTag::Github => Some(
                directories::cached_github_folder_name(pm, resolution.github(), None)
                    .as_bytes()
                    .to_vec(),
            ),
            ResolutionTag::RemoteTarball => Some(
                directories::cached_tarball_folder_name(pm, *resolution.remote_tarball(), None)
                    .as_bytes()
                    .to_vec(),
            ),
            _ => None,
        };
        if let Some(f) = folder {
            if !f.is_empty() && !out.iter().any(|(e, _)| *e == f) {
                out.push((f, expected));
            }
        }
    }
    out.sort();
    out
}

fn write_record(
    w: &mut impl Write,
    kind: u8,
    path: &[u8],
    mode: u32,
    data: &[u8],
) -> std::io::Result<()> {
    w.write_all(&[kind])?;
    w.write_all(&(path.len() as u32).to_le_bytes())?;
    w.write_all(path)?;
    w.write_all(&mode.to_le_bytes())?;
    w.write_all(&(data.len() as u64).to_le_bytes())?;
    w.write_all(data)
}

fn pack_dir(
    w: &mut impl Write,
    root: &Path,
    rel: &Path,
    files: &mut u64,
    bytes: &mut u64,
) -> std::io::Result<()> {
    let mut entries: Vec<std::fs::DirEntry> =
        std::fs::read_dir(root.join(rel))?.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    if entries.is_empty() && !rel.as_os_str().is_empty() {
        write_record(w, 4, rel.as_os_str().as_encoded_bytes(), 0o755, &[])?;
    }
    for e in entries {
        let ft = e.file_type()?;
        let child_rel = rel.join(e.file_name());
        let relb = child_rel.as_os_str().as_encoded_bytes();
        if ft.is_dir() {
            pack_dir(w, root, &child_rel, files, bytes)?;
        } else if ft.is_symlink() {
            let target = std::fs::read_link(root.join(&child_rel))?;
            write_record(w, 3, relb, 0o777, target.as_os_str().as_encoded_bytes())?;
        } else if ft.is_file() {
            let data = std::fs::read(root.join(&child_rel))?;
            #[cfg(unix)]
            let mode = {
                use std::os::unix::fs::PermissionsExt;
                e.metadata()?.permissions().mode()
            };
            #[cfg(not(unix))]
            let mode = 0o644u32;
            *files += 1;
            *bytes += data.len() as u64;
            write_record(w, 2, relb, mode, &data)?;
        }
    }
    Ok(())
}

/// Write a pack of every cache folder the lockfile references that exists locally.
pub fn pack(
    pm: &mut PackageManager,
    cache_dir: &[u8],
    out_path: &[u8],
) -> std::io::Result<PackSummary> {
    let folders = cache_folder_names(pm);
    let cache = PathBuf::from(s(cache_dir));
    let tmp = format!("{}.tmp", s(out_path));
    let file = std::fs::File::create(&tmp)?;
    let mut w = BufWriter::with_capacity(1 << 20, file);
    w.write_all(MAGIC)?;
    let mut summary = PackSummary {
        packages: 0,
        files: 0,
        bytes: 0,
        skipped_missing: 0,
    };
    for (f, expected_here) in &folders {
        let dir = cache.join(s(f));
        if !dir.is_dir() {
            // optional binaries for other platforms are legitimately absent
            if *expected_here {
                summary.skipped_missing += 1;
            }
            continue;
        }
        write_record(&mut w, 1, f, 0, &[])?;
        pack_dir(
            &mut w,
            &dir,
            Path::new(""),
            &mut summary.files,
            &mut summary.bytes,
        )?;
        summary.packages += 1;
    }
    write_record(&mut w, 0, b"", 0, &[])?;
    w.flush()?;
    drop(w);
    std::fs::rename(&tmp, s(out_path))?;
    Ok(summary)
}

fn read_exact_vec(r: &mut impl Read, n: usize) -> std::io::Result<Vec<u8>> {
    let mut v = vec![0u8; n];
    r.read_exact(&mut v)?;
    Ok(v)
}

fn bad(msg: &str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, msg.to_string())
}

/// Reject anything that could write outside the folder being restored.
fn safe_rel(path: &[u8]) -> bool {
    !path.is_empty()
        && path[0] != b'/'
        && path[0] != b'\\'
        && !path.contains(&0)
        && !path.contains(&b':')
        && !path
            .split(|c| *c == b'/' || *c == b'\\')
            .any(|seg| seg == b"..")
}

/// A cache folder name is either `name@ver…` or `@scope/name@ver…` (one slash).
fn safe_folder_name(name: &[u8]) -> bool {
    if !safe_rel(name) || name.contains(&b'\\') || name == b"." || name == b".." {
        return false;
    }
    let slashes = name.iter().filter(|c| **c == b'/').count();
    slashes == 0 || (slashes == 1 && name[0] == b'@' && !name.ends_with(b"/"))
}

/// Restore missing cache folders from a pack. Existing folders are left untouched
/// (their bytes are skipped without being written).
pub fn unpack(cache_dir: &[u8], pack_path: &[u8]) -> std::io::Result<UnpackSummary> {
    let result = unpack_impl(cache_dir, pack_path);
    if result.is_err() {
        // don't leave a half-written staging dir behind
        let cache = PathBuf::from(s(cache_dir));
        if let Ok(rd) = std::fs::read_dir(&cache) {
            let mine = format!(".unpack-{}-", std::process::id());
            for e in rd.flatten() {
                if e.file_name()
                    .as_encoded_bytes()
                    .starts_with(mine.as_bytes())
                {
                    let _ = std::fs::remove_dir_all(e.path());
                }
            }
        }
    }
    result
}

fn unpack_impl(cache_dir: &[u8], pack_path: &[u8]) -> std::io::Result<UnpackSummary> {
    let cache = PathBuf::from(s(cache_dir));
    std::fs::create_dir_all(&cache)?;
    let file = std::fs::File::open(s(pack_path))?;
    let mut r = BufReader::with_capacity(1 << 20, file);
    let magic = read_exact_vec(&mut r, MAGIC.len())?;
    if magic != MAGIC {
        return Err(bad("not a bun cache pack (bad magic)"));
    }
    let mut summary = UnpackSummary {
        packages: 0,
        created: 0,
        already_present: 0,
        bytes: 0,
    };
    // sweep staging dirs left by an earlier failed/killed unpack
    if let Ok(rd) = std::fs::read_dir(&cache) {
        for e in rd.flatten() {
            if e.file_name().as_encoded_bytes().starts_with(b".unpack-") {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
    // current folder: (final path, staging path) — None while skipping an existing one
    let mut current: Option<(PathBuf, PathBuf)> = None;
    let mut skipping = false;
    let pid = std::process::id();

    let finish = |cur: &mut Option<(PathBuf, PathBuf)>,
                  summary: &mut UnpackSummary|
     -> std::io::Result<()> {
        if let Some((final_path, staging)) = cur.take() {
            match std::fs::rename(&staging, &final_path) {
                Ok(()) => summary.created += 1,
                Err(e) if final_path.is_dir() => {
                    // lost a race with a concurrent unpack/install: theirs is as good as ours
                    let _ = e;
                    let _ = std::fs::remove_dir_all(&staging);
                    summary.already_present += 1;
                }
                Err(e) => return Err(e),
            }
        }
        Ok(())
    };

    loop {
        let mut kind = [0u8; 1];
        r.read_exact(&mut kind)?;
        let mut u32b = [0u8; 4];
        r.read_exact(&mut u32b)?;
        let path_len = u32::from_le_bytes(u32b) as usize;
        if path_len > 4096 {
            return Err(bad("path too long"));
        }
        let path = read_exact_vec(&mut r, path_len)?;
        r.read_exact(&mut u32b)?;
        let mode = u32::from_le_bytes(u32b);
        let mut u64b = [0u8; 8];
        r.read_exact(&mut u64b)?;
        let size = u64::from_le_bytes(u64b);
        match kind[0] {
            0 => {
                finish(&mut current, &mut summary)?;
                break;
            }
            1 => {
                finish(&mut current, &mut summary)?;
                if !safe_folder_name(&path) {
                    return Err(bad("unsafe cache folder name in pack"));
                }
                summary.packages += 1;
                let final_path = cache.join(s(&path));
                if final_path.exists() {
                    skipping = true;
                    summary.already_present += 1;
                    current = None;
                } else {
                    skipping = false;
                    if let Some(parent) = final_path.parent() {
                        // `@scope/` directory for scoped packages
                        std::fs::create_dir_all(parent)?;
                    }
                    let staging = cache.join(format!(".unpack-{}-{}", pid, summary.packages));
                    let _ = std::fs::remove_dir_all(&staging);
                    std::fs::create_dir_all(&staging)?;
                    current = Some((final_path, staging));
                }
                if size != 0 {
                    return Err(bad("folder record with payload"));
                }
            }
            2 | 3 | 4 => {
                if size > (1u64 << 34) {
                    return Err(bad("entry too large"));
                }
                if skipping || current.is_none() {
                    // consume payload without writing
                    std::io::copy(&mut (&mut r).take(size), &mut std::io::sink())?;
                    continue;
                }
                if !safe_rel(&path) {
                    return Err(bad("unsafe entry path in pack"));
                }
                let (_, staging) = current.as_ref().unwrap();
                let dest = staging.join(s(&path));
                // refuse to traverse a symlink materialized earlier in this package
                {
                    let mut p = staging.clone();
                    let rel = std::path::Path::new(s(&path));
                    let comps: Vec<_> = rel.components().collect();
                    for (i, c) in comps.iter().enumerate() {
                        p.push(c);
                        if let Ok(m) = std::fs::symlink_metadata(&p) {
                            if m.file_type().is_symlink() && (i + 1 < comps.len() || kind[0] != 3) {
                                return Err(bad("pack entry traverses a symlink"));
                            }
                        }
                    }
                }
                match kind[0] {
                    4 => {
                        std::fs::create_dir_all(&dest)?;
                        std::io::copy(&mut (&mut r).take(size), &mut std::io::sink())?;
                    }
                    3 => {
                        if size > 4096 {
                            return Err(bad("symlink target too long"));
                        }
                        let target = read_exact_vec(&mut r, size as usize)?;
                        // links inside a package may only point within it (no `..`, not absolute)
                        let t: &[u8] = target.strip_prefix(b"./").unwrap_or(&target);
                        if !safe_rel(t) {
                            return Err(bad("unsafe symlink target in pack"));
                        }
                        if let Some(parent) = dest.parent() {
                            std::fs::create_dir_all(parent)?;
                        }
                        #[cfg(unix)]
                        std::os::unix::fs::symlink(s(&target), &dest)?;
                        #[cfg(windows)]
                        {
                            // file symlinks need privileges on Windows; write a copy stub instead
                            let _ = target;
                        }
                    }
                    _ => {
                        if let Some(parent) = dest.parent() {
                            std::fs::create_dir_all(parent)?;
                        }
                        let mut f = std::fs::File::create(&dest)?;
                        let copied = std::io::copy(&mut (&mut r).take(size), &mut f)?;
                        if copied != size {
                            return Err(bad("truncated pack"));
                        }
                        summary.bytes += size;
                        #[cfg(unix)]
                        {
                            use std::os::unix::fs::PermissionsExt;
                            // keep the executable bit, never setuid/setgid/sticky or world-write
                            let m = (mode & 0o755) | 0o600;
                            std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(m))?;
                        }
                        #[cfg(not(unix))]
                        let _ = mode;
                    }
                }
            }
            _ => return Err(bad("unknown record kind")),
        }
    }
    Ok(summary)
}
