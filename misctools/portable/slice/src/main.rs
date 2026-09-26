//! A program of the portable image that reaches the file system through bun's crates.
//!
//!   bun_fs_slice <directory>     runs the steps below in <directory>/slice-tree and prints one JSON
//!                                object for each. The directory has to exist; the tree is removed
//!                                before the first step and by the last ones.
//!   bun_fs_slice --imports       binds every function of Windows that the image can call and prints the
//!                                ones the host could not resolve
//!   bun_fs_slice --layout        prints the size, the offsets of the fields and the constants of the
//!                                bindings, as the image has them (see misctools/portable/bindings)
//!   bun_fs_slice --abi           calls the functions of the Linux test host that have the calling
//!                                convention of Windows
//!
//! Every file system call is one of `bun_sys`, with paths made by `bun_paths`, the way bun's runtime
//! makes them. Which implementation answers is bun's choice: in the portable image the one for the OS of
//! the host. The output has no absolute path, no time and no number that depends on the machine, so one
//! expected output serves every host (`expected/`).
#![no_main]

use core::ffi::{c_char, c_int};

use bun_core::ZStr;
use bun_paths::resolve_path::{self, platform};
use bun_sys::{Fd, File, Maybe, O};

#[cfg(bun_portable)]
mod abi;
mod json;
#[cfg(bun_portable)]
mod layout;
#[cfg(bun_portable)]
mod layout_generated;

use json::Report;

/// mimalloc as the process allocator, as in bun's `bin_entry`.
#[global_allocator]
static ALLOCATOR: bun_alloc::Mimalloc = bun_alloc::Mimalloc;

const TREE: &[u8] = b"slice-tree";

/// The directory the steps run in, and the paths inside of it.
struct Work {
    /// `<directory>`, absolute, in the path flavour of the host.
    base: Vec<u8>,
    /// `<directory>/slice-tree`
    root: Vec<u8>,
    windows_paths: bool,
}

impl Work {
    /// Removes the tree with everything in it, the way `rm -rf` of bun does: through a handle of
    /// the directory it is in.
    fn delete_tree(&self) -> Maybe<()> {
        let parent = bun_sys::Dir::from_fd(bun_sys::open_dir_absolute(&self.base)?);
        parent.delete_tree(TREE)
    }

    /// `<root>/<relative>` with the separators of the host, NUL-terminated.
    fn path(&self, relative: &[u8]) -> Vec<u8> {
        let mut buffer = bun_paths::path_buffer_pool::get();
        let joined = if self.windows_paths {
            resolve_path::join_string_buf::<platform::Windows>(&mut buffer[..], &[&self.root, relative])
        } else {
            resolve_path::join_string_buf::<platform::Posix>(&mut buffer[..], &[&self.root, relative])
        };
        let mut path = joined.to_vec();
        path.push(0);
        path
    }
}

fn z(path: &[u8]) -> &ZStr {
    debug_assert!(path.last() == Some(&0));
    ZStr::from_buf(path, path.len() - 1)
}

fn host_is_windows() -> bool {
    #[cfg(bun_portable)]
    {
        bun_core::host::is_windows()
    }
    #[cfg(not(bun_portable))]
    {
        cfg!(windows)
    }
}

fn kind_name(kind: bun_sys::FileKind) -> &'static str {
    use bun_sys::FileKind as K;
    match kind {
        K::File => "file",
        K::Directory => "directory",
        K::SymLink => "symlink",
        K::BlockDevice => "block device",
        K::CharacterDevice => "character device",
        K::NamedPipe => "pipe",
        K::UnixDomainSocket => "socket",
        _ => "other",
    }
}

/// What the steps print of a `Stat`: its kind and its size. Times, owners and inode numbers are the
/// machine's.
fn stat_fields(report: &mut Report, stat: &bun_sys::Stat) {
    let kind = bun_sys::kind_from_mode(stat.st_mode as bun_sys::Mode);
    report.string("kind", kind_name(kind).as_bytes());
    if kind == bun_sys::FileKind::File {
        report.number("size", stat.st_size as i64);
    }
}

fn run_steps(directory: &[u8]) -> bool {
    let windows_paths = host_is_windows();
    let mut report = Report::new();

    report.begin("host");
    #[cfg(bun_portable)]
    report.string("os", bun_core::host::os().name_string().as_bytes());
    #[cfg(not(bun_portable))]
    report.string("os", bun_core::env::OS.name_string().as_bytes());
    report.string("path_flavour", if windows_paths { b"windows" } else { b"posix" });
    report.string("image", if cfg!(bun_portable) { b"portable" } else { b"native" });
    report.end_ok();

    let mut cwd_buffer = bun_paths::path_buffer_pool::get();
    let (base, root) = {
        let cwd = match bun_sys::getcwd(&mut cwd_buffer[..]) {
            Ok(length) => cwd_buffer[..length].to_vec(),
            Err(error) => {
                report.begin("getcwd");
                report.end_error(&error);
                report.print();
                return false;
            }
        };
        let join = |parts: &[&[u8]]| {
            let mut buffer = bun_paths::path_buffer_pool::get();
            if windows_paths {
                resolve_path::join_abs_string_buf::<platform::Windows>(&cwd, &mut buffer[..], parts).to_vec()
            } else {
                resolve_path::join_abs_string_buf::<platform::Posix>(&cwd, &mut buffer[..], parts).to_vec()
            }
        };
        (join(&[directory]), join(&[directory, TREE]))
    };
    let work = Work { base, root, windows_paths };

    // Left by a run that did not finish.
    let _ = work.delete_tree();
    report.begin("start");
    report.boolean("tree_exists", bun_sys::exists(&work.root));
    report.end_ok();

    // ── directories ──
    let root_z = work.path(b"");
    report.step("mkdir", b"", bun_sys::mkdir(z(&root_z), 0o755));
    report.step("mkdir again", b"", bun_sys::mkdir(z(&root_z), 0o755));
    report.step("mkdir, parent missing", b"no/such", bun_sys::mkdir(z(&work.path(b"no/such")), 0o755));

    let root_fd = match bun_sys::open_dir_absolute(&work.root) {
        Ok(fd) => {
            report.begin("open directory");
            report.end_ok();
            fd
        }
        Err(error) => {
            report.begin("open directory");
            report.end_error(&error);
            report.print();
            return false;
        }
    };
    report.step("mkdir_recursive_at", b"a/b/c", bun_sys::mkdir_recursive_at_mode(root_fd, b"a/b/c", 0o755));
    report.step("mkdir_recursive_at again", b"a/b/c", bun_sys::mkdir_recursive_at_mode(root_fd, b"a/b/c", 0o755));
    report.step("mkdirat", b"a/side", bun_sys::mkdirat(root_fd, z(b"a/side\0"), 0o755));

    // ── create, write, append ──
    let hello = work.path(b"a/hello.txt");
    report.begin("open, create");
    report.string("path", b"a/hello.txt");
    match bun_sys::open(z(&hello), O::WRONLY | O::CREAT | O::TRUNC, 0o644) {
        Ok(fd) => {
            report.end_ok();
            let file = File::from_fd(fd);
            report.step("write", b"a/hello.txt", file.write_all(b"hello, "));
            report.step("write", b"a/hello.txt", file.write_all(b"world\n"));
            report.begin("fstat");
            match bun_sys::fstat(fd) {
                Ok(stat) => {
                    stat_fields(&mut report, &stat);
                    report.end_ok();
                }
                Err(error) => report.end_error(&error),
            }
            report.step("close", b"a/hello.txt", bun_sys::close(file.into_raw()));
        }
        Err(error) => report.end_error(&error),
    }
    report.begin("open, create exclusive, exists");
    match bun_sys::open(z(&hello), O::WRONLY | O::CREAT | O::EXCL, 0o644) {
        Ok(fd) => {
            let _ = bun_sys::close(fd);
            report.end_ok();
        }
        Err(error) => report.end_error(&error),
    }
    report.begin("open, append");
    match bun_sys::open(z(&hello), O::WRONLY | O::APPEND, 0) {
        Ok(fd) => {
            report.end_ok();
            let file = File::from_fd(fd);
            report.step("write, appended", b"a/hello.txt", file.write_all(b"appended\n"));
        }
        Err(error) => report.end_error(&error),
    }

    // ── read, pread ──
    report.begin("openat, read");
    report.string("path", b"a/hello.txt");
    match bun_sys::openat(root_fd, z(b"a/hello.txt\0"), O::RDONLY, 0) {
        Ok(fd) => {
            let file = File::from_fd(fd);
            match file.read_to_end() {
                Ok(bytes) => {
                    report.string("content", &bytes);
                    report.end_ok();
                }
                Err(error) => report.end_error(&error),
            }
            let mut five = [0u8; 5];
            report.begin("pread");
            match bun_sys::pread(fd, &mut five, 7) {
                Ok(count) => {
                    report.string("content", &five[..count]);
                    report.end_ok();
                }
                Err(error) => report.end_error(&error),
            }
            let mut past = [0u8; 8];
            report.begin("pread, past the end");
            match bun_sys::pread(fd, &mut past, 1000) {
                Ok(count) => {
                    report.number("count", count as i64);
                    report.end_ok();
                }
                Err(error) => report.end_error(&error),
            }
            report.begin("fstat, of openat");
            match bun_sys::fstat(fd) {
                Ok(stat) => {
                    stat_fields(&mut report, &stat);
                    report.end_ok();
                }
                Err(error) => report.end_error(&error),
            }
        }
        Err(error) => report.end_error(&error),
    }
    report.begin("open, missing");
    match bun_sys::open(z(&work.path(b"a/missing.txt")), O::RDONLY, 0) {
        Ok(fd) => {
            let _ = bun_sys::close(fd);
            report.end_ok();
        }
        Err(error) => report.end_error(&error),
    }

    // ── stat, lstat ──
    for (step, path) in [
        ("stat", &b"a/hello.txt"[..]),
        ("stat, directory", b"a/b"),
        ("stat, missing", b"a/missing.txt"),
    ] {
        report.begin(step);
        report.string("path", path);
        match bun_sys::stat(z(&work.path(path))) {
            Ok(stat) => {
                stat_fields(&mut report, &stat);
                report.end_ok();
            }
            Err(error) => report.end_error(&error),
        }
    }
    report.begin("lstat");
    report.string("path", b"a/hello.txt");
    match bun_sys::lstat(z(&hello)) {
        Ok(stat) => {
            stat_fields(&mut report, &stat);
            report.end_ok();
        }
        Err(error) => report.end_error(&error),
    }
    report.begin("exists");
    report.boolean("a/hello.txt", bun_sys::exists(&hello[..hello.len() - 1]));
    report.boolean("a/missing.txt", bun_sys::exists(&work.path(b"a/missing.txt")[..work.path(b"a/missing.txt").len() - 1]));
    report.end_ok();

    // ── rename ──
    let renamed = work.path(b"a/b/renamed.txt");
    report.step("rename", b"a/hello.txt -> a/b/renamed.txt", bun_sys::rename(z(&hello), z(&renamed)));
    report.step("rename, missing", b"a/hello.txt -> a/b/renamed.txt", bun_sys::rename(z(&hello), z(&renamed)));
    report.step(
        "renameat",
        b"a/b/renamed.txt -> a/renamed.txt",
        bun_sys::renameat(root_fd, z(b"a/b/renamed.txt\0"), root_fd, z(b"a/renamed.txt\0")),
    );
    let renamed = work.path(b"a/renamed.txt");

    // ── copy ──
    report.begin("copy_file");
    report.string("path", b"a/renamed.txt -> a/copy.txt");
    let copied = (|| -> Maybe<()> {
        let from = File::from_fd(bun_sys::open(z(&renamed), O::RDONLY, 0)?);
        let to = File::from_fd(bun_sys::open(z(&work.path(b"a/copy.txt")), O::WRONLY | O::CREAT | O::TRUNC, 0o644)?);
        bun_sys::copy_file(from.handle(), to.handle())
    })();
    match copied {
        Ok(()) => report.end_ok(),
        Err(error) => report.end_error(&error),
    }
    report.begin("read the copy");
    match bun_sys::open(z(&work.path(b"a/copy.txt")), O::RDONLY, 0).and_then(|fd| File::from_fd(fd).read_to_end()) {
        Ok(bytes) => {
            report.string("content", &bytes);
            report.end_ok();
        }
        Err(error) => report.end_error(&error),
    }

    // ── truncate ──
    report.begin("ftruncate");
    report.string("path", b"a/copy.txt");
    let truncated = (|| -> Maybe<Vec<u8>> {
        let file = File::from_fd(bun_sys::openat(root_fd, z(b"a/copy.txt\0"), O::RDWR, 0)?);
        bun_sys::ftruncate(file.handle(), 5)?;
        let stat = bun_sys::fstat(file.handle())?;
        let mut bytes = vec![0u8; 16];
        let count = bun_sys::pread(file.handle(), &mut bytes, 0)?;
        bytes.truncate(count);
        if stat.st_size as u64 != 5 {
            bytes.extend_from_slice(b" (fstat does not say 5)");
        }
        Ok(bytes)
    })();
    match truncated {
        Ok(bytes) => {
            report.string("content", &bytes);
            report.end_ok();
        }
        Err(error) => report.end_error(&error),
    }

    // ── a name that is not ASCII ──
    let unicode = "a/gr\u{fc}\u{df}e \u{2713} \u{1f35e}.txt".as_bytes();
    report.begin("create, name that is not ASCII");
    match bun_sys::openat(root_fd, z(&[unicode, b"\0"].concat()), O::WRONLY | O::CREAT | O::TRUNC, 0o644) {
        Ok(fd) => {
            let file = File::from_fd(fd);
            match file.write_all(unicode) {
                Ok(()) => report.end_ok(),
                Err(error) => report.end_error(&error),
            }
        }
        Err(error) => report.end_error(&error),
    }

    // ── symbolic link ──
    let link = work.path(b"a/link");
    let symlinked = bun_sys::symlink(z(b"renamed.txt\0"), z(&link));
    let have_link = symlinked.is_ok();
    report.step("symlink", b"a/link -> renamed.txt", symlinked);
    if have_link {
        let mut target = bun_paths::path_buffer_pool::get();
        report.begin("readlink");
        match bun_sys::readlink(z(&link), &mut target[..]) {
            Ok(length) => {
                report.string("target", &target[..length]);
                report.end_ok();
            }
            Err(error) => report.end_error(&error),
        }
        report.begin("lstat, link");
        match bun_sys::lstat(z(&link)) {
            Ok(stat) => {
                report.string("kind", kind_name(bun_sys::kind_from_mode(stat.st_mode as bun_sys::Mode)).as_bytes());
                report.end_ok();
            }
            Err(error) => report.end_error(&error),
        }
        report.begin("stat, through the link");
        match bun_sys::stat(z(&link)) {
            Ok(stat) => {
                stat_fields(&mut report, &stat);
                report.end_ok();
            }
            Err(error) => report.end_error(&error),
        }
    }
    report.begin("readlink, not a link");
    {
        let mut target = bun_paths::path_buffer_pool::get();
        match bun_sys::readlink(z(&renamed), &mut target[..]) {
            Ok(length) => {
                report.string("target", &target[..length]);
                report.end_ok();
            }
            Err(error) => report.end_error(&error),
        }
    }

    // ── list ──
    report.begin("list");
    report.string("path", b"a");
    match bun_sys::open_dir_at(root_fd, b"a") {
        Ok(directory) => {
            let mut entries: Vec<(Vec<u8>, &'static str)> = Vec::new();
            let mut iterator = bun_sys::iterate_dir(directory);
            let listed = loop {
                match iterator.next() {
                    Ok(Some(entry)) => entries.push((entry.name.slice_u8().to_vec(), kind_name(entry.kind))),
                    Ok(None) => break Ok(()),
                    Err(error) => break Err(error),
                }
            };
            entries.sort();
            report.entries("entries", &entries);
            match listed {
                Ok(()) => report.end_ok(),
                Err(error) => report.end_error(&error),
            }
            let _ = bun_sys::close(directory);
        }
        Err(error) => report.end_error(&error),
    }

    // ── remove ──
    report.step("rmdir, not empty", b"a", bun_sys::rmdir(z(&work.path(b"a"))));
    report.step("unlink, directory", b"a/side", bun_sys::unlink(z(&work.path(b"a/side"))));
    report.step("unlink, missing", b"a/missing.txt", bun_sys::unlink(z(&work.path(b"a/missing.txt"))));
    if have_link {
        report.step("unlink, link", b"a/link", bun_sys::unlink(z(&link)));
    }
    report.step("unlink", b"a/copy.txt", bun_sys::unlink(z(&work.path(b"a/copy.txt"))));
    report.step("unlinkat", b"a/renamed.txt", bun_sys::unlinkat(root_fd, z(b"a/renamed.txt\0")));
    report.step("unlinkat, name that is not ASCII", b"", bun_sys::unlinkat(root_fd, z(&[unicode, b"\0"].concat())));
    report.step("rmdirat", b"a/side", bun_sys::rmdirat(root_fd, z(b"a/side\0")));
    report.step("rmdir", b"a/b/c", bun_sys::rmdir(z(&work.path(b"a/b/c"))));
    let _ = bun_sys::close(root_fd);
    report.step("delete_tree", b"", work.delete_tree());
    report.begin("end");
    report.boolean("tree_exists", bun_sys::exists(&work.root));
    report.end_ok();

    report.print()
}

unsafe extern "C" {
    /// bun_core: what bun runs when the process ends. It flushes the output and gives the console
    /// back as it was (on Windows: its modes and its code pages).
    safe fn Bun__onExit();
}

fn usage() -> c_int {
    let _ = File::borrow(&Fd::stderr()).write_all(
        b"usage: bun_fs_slice <directory> | --imports | --layout | --abi\n",
    );
    2
}

#[unsafe(no_mangle)]
pub extern "C" fn main(argc: c_int, argv: *const *const c_char) -> c_int {
    #[cfg(bun_portable)]
    let invalid_hook = bun_core::host::init().err();
    // SAFETY: `argv` is the vector of the C runtime: `argc` pointers to NUL-terminated strings that live
    // as long as the process.
    let arguments: Vec<&'static [u8]> = (1..argc.max(1) as usize)
        .map(|index| unsafe { core::ffi::CStr::from_ptr(*argv.add(index)).to_bytes() })
        .collect();
    bun_core::output::stdio::init();
    #[cfg(bun_portable)]
    if let Some(invalid) = invalid_hook {
        let _ = File::borrow(&Fd::stderr()).write_all(b"bun_fs_slice: BUN_PORTABLE_HOST_OS is not linux, darwin or win32: ");
        let _ = File::borrow(&Fd::stderr()).write_all(invalid.0);
        let _ = File::borrow(&Fd::stderr()).write_all(b"\n");
        return 2;
    }
    let passed = match arguments.as_slice() {
        #[cfg(bun_portable)]
        [b"--imports"] => abi::print_imports(),
        #[cfg(bun_portable)]
        [b"--layout"] => layout::print(),
        #[cfg(bun_portable)]
        [b"--abi"] => abi::run(),
        [directory] if !directory.starts_with(b"--") => run_steps(directory),
        _ => return usage(),
    };
    Bun__onExit();
    if passed { 0 } else { 1 }
}
