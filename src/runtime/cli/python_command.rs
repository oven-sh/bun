//! `python3`: under that name Bun is CPython's command, which JavaScriptCore implements (`python/runtime/PyCommandLine.cpp`).

use core::ffi::{c_char, c_int};

use bun_core::{Global, Output};

unsafe extern "C" {
    /// The exit status, if there is nothing to run (`--version`, `--help`, a mistake). Negative: there is.
    fn Bun__Python__readCommandLine(argc: usize, argv: *const *const c_char) -> c_int;
}

pub(crate) fn is_python(argv0: &[u8]) -> bool {
    is_name_of_python(argv0) || executed_as_python().is_some()
}

fn is_name_of_python(path: &[u8]) -> bool {
    let name = bun_paths::basename(path);
    #[cfg(windows)]
    let name = name.strip_suffix(b".exe").unwrap_or(name);
    matches!(name, b"python" | b"python3" | b"python3.15")
}

/// What was given to `execve()`, if that makes this Python: a parent may put anything in argv[0] (`subprocess.Popen(executable=)`).
/// The path has the name of Python, or is a symbolic link, of whatever name, that leads here by way of one that has.
/// For a script that names Bun in its `#!` line it is the script, whose name says nothing.
#[cfg(any(target_os = "linux", target_os = "android"))]
fn executed_as_python() -> Option<&'static [u8]> {
    static ANSWER: std::sync::OnceLock<Option<&'static [u8]>> = std::sync::OnceLock::new();
    *ANSWER.get_or_init(find_executed_as_python)
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn find_executed_as_python() -> Option<&'static [u8]> {
    use bun_core::ZBox;

    // SAFETY: `getauxval` only reads the vector the kernel gave the process, and the string lives as long as the process.
    let executed = unsafe {
        let path = libc::getauxval(libc::AT_EXECFN) as *const c_char;
        if path.is_null() {
            return None;
        }
        core::ffi::CStr::from_ptr(path).to_bytes()
    };
    let mut path = ZBox::from_bytes(executed);
    for _ in 0..8 {
        if is_name_of_python(path.as_bytes()) {
            let named = bun_sys::stat(&path).ok()?;
            let this = bun_sys::stat(bun_core::zstr!("/proc/self/exe")).ok()?;
            return (named.st_dev == this.st_dev && named.st_ino == this.st_ino).then_some(executed);
        }
        let mut buf = bun_paths::path_buffer_pool::get();
        let length = bun_sys::readlink(&path, &mut buf).ok()?;
        let target = &buf[..length];
        path = if target.first() == Some(&b'/') || !path.as_bytes().contains(&b'/') {
            ZBox::from_bytes(target)
        } else {
            ZBox::from_vec([bun_paths::dirname_simple(path.as_bytes()), b"/", target].concat())
        };
    }
    None
}

#[cfg(not(any(target_os = "linux", target_os = "android")))]
fn executed_as_python() -> Option<&'static [u8]> {
    None
}

/// `sys.executable` of `python3`, where the system tells. Empty: it does not, so argv[0] has to do.
#[unsafe(no_mangle)]
extern "C" fn Bun__Python__executedPath() -> bun_core::String {
    executed_as_python().map_or(bun_core::String::EMPTY, bun_core::String::clone_utf8)
}

/// Before there is a VM: some of the options decide how it starts.
pub(crate) fn read_command_line() {
    let argv = bun_core::argv();
    // `BUN_OPTIONS` is spliced in after argv[0], and is about another command line.
    let from_bun_options = 1..1 + bun_core::bun_options_argc();
    let arguments: Vec<*const c_char> = argv
        .as_slice()
        .iter()
        .enumerate()
        .filter(|(i, _)| !from_bun_options.contains(i))
        .map(|(_, argument)| argument.as_ptr().cast::<c_char>())
        .collect();
    // SAFETY: argv is NUL-terminated and lives as long as the process; C++ copies what it keeps.
    let status = unsafe { Bun__Python__readCommandLine(arguments.len(), arguments.as_ptr()) };
    if status >= 0 {
        Output::flush();
        Global::exit(status as u32);
    }
}

/// `sys.orig_argv`, one at a time. Null: there are no more.
#[unsafe(no_mangle)]
extern "C" fn Bun__Python__originalArgument(index: usize) -> *const c_char {
    // `BUN_OPTIONS` is spliced in after argv[0].
    let index = if index == 0 {
        0
    } else {
        index + bun_core::bun_options_argc()
    };
    bun_core::argv()
        .get(index)
        .map_or(core::ptr::null(), |argument| argument.as_ptr().cast())
}

/// `os.chdir()` has changed the working directory. What `process.chdir()` does besides that. Not by way of the name, which need
/// not be text: JavaScript could not spell it.
#[unsafe(no_mangle)]
extern "C" fn Bun__Python__didChangeDirectory(global_object: &bun_jsc::JSGlobalObject) {
    let vm = global_object.bun_vm().as_mut();
    let previous: Box<[u8]> = Box::from(
        bun_core::working_directory_in_executable().unwrap_or_else(|| vm.top_level_dir()),
    );
    // It may have no name any more, or none that this process may read.
    if vm.process_cwd_changed().is_err() {
        return;
    }
    bun_core::set_working_directory_in_executable(None);
    vm.test_isolation_scope(|state| {
        state.saved_cwd.get_or_insert(previous);
    });
}

/// `Bun.main` of the thread. Empty: there is none.
#[unsafe(no_mangle)]
extern "C" fn Bun__Python__mainFile(global_object: &bun_jsc::JSGlobalObject) -> bun_core::String {
    global_object
        .bun_vm()
        .main()
        .map_or(bun_core::String::EMPTY, bun_core::String::clone_utf8)
}

/// `sys.executable`: a link named `python3` to this executable, in a directory of this user and this executable. Empty: none.
#[unsafe(no_mangle)]
extern "C" fn Bun__Python__linkToSelf() -> bun_core::String {
    link_to_self().unwrap_or(bun_core::String::EMPTY)
}

#[cfg(windows)]
fn link_to_self() -> Option<bun_core::String> {
    None
}

#[cfg(not(windows))]
fn link_to_self() -> Option<bun_core::String> {
    use bun_core::ZBox;

    const TMP: &str = if cfg!(target_os = "macos") {
        "/private/tmp"
    } else if cfg!(target_os = "android") {
        "/data/local/tmp"
    } else {
        "/tmp"
    };
    let exe = bun_core::self_exe_path().ok()?;
    if exe.as_bytes().is_empty() {
        return None;
    }
    let dir = ZBox::from_bytes(format!(
        "{TMP}/bun-python-{}-{:016x}",
        bun_sys::c::getuid(),
        bun_wyhash::hash(exe.as_bytes())
    ));

    // As for the directory of the `node` link: /tmp is everybody's.
    match bun_sys::mkdir(&dir, 0o700) {
        Ok(()) => {}
        Err(e) if e.get_errno() == bun_sys::E::EEXIST => match bun_sys::lstat(&dir) {
            Ok(st)
                if bun_sys::kind_from_mode(st.st_mode as bun_sys::Mode)
                    == bun_sys::FileKind::Directory
                    && st.st_uid == bun_sys::c::getuid()
                    && (st.st_mode as bun_sys::Mode) & 0o022 == 0 => {}
            _ => return None,
        },
        Err(_) => return None,
    }

    let link = |name: &[u8]| ZBox::from_vec([dir.as_bytes(), b"/", name].concat());
    for name in [&b"python3"[..], b"python", b"python3.15"] {
        let dest = link(name);
        let mut replaced = false;
        loop {
            match bun_sys::symlink(exe, &dest) {
                Ok(()) => break,
                Err(e) if e.get_errno() == bun_sys::E::EEXIST => {
                    let mut buf = bun_paths::path_buffer_pool::get();
                    let matches = bun_sys::readlink(&dest, &mut buf)
                        .map(|n| &buf[..n] == exe.as_bytes())
                        .unwrap_or(false);
                    if matches {
                        break;
                    }
                    if replaced {
                        return None;
                    }
                    let _ = bun_sys::unlink(&dest);
                    replaced = true;
                }
                Err(_) => return None,
            }
        }
    }
    Some(bun_core::String::clone_utf8(link(b"python3").as_bytes()))
}
