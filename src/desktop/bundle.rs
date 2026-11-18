//! What is done to an app bundle. It needs no script, and part of it may run as root.

use core::ffi::c_char;

use bun_core::{CStringList, ZBox, zstr};
use bun_spawn_sys::spawn_process::{PosixSpawnOptions, PosixStdio, spawn_process_posix};
use bun_sys::{Dir, E, File, O, RenameMode, Stat};

use crate::text::{contains, random_bytes, split, split_once, string};
use crate::{IS_MAC, files, process};

/// The same as in src/runtime/desktop/main_thread.rs.
pub(crate) const INSTALL: &str = "--bun-desktop-install-update";
const ARCHIVE: &str = "update.zip";
const STAGED: &str = "update.app";

pub(crate) enum Refusal {
    Archive(String),
    Missing,
    Signature(String),
    Older,
    Running,
    System(bun_sys::Error),
}

impl From<bun_sys::Error> for Refusal {
    fn from(error: bun_sys::Error) -> Refusal {
        Refusal::System(error)
    }
}

impl Refusal {
    pub(crate) fn describe(&self) -> (&'static str, i32, String) {
        let (updater, installer) = ("SQRLUpdaterErrorDomain", "SQRLInstallerErrorDomain");
        match self {
            Refusal::Archive(why) => ("SQRLZipArchiverErrorDomain", 1, why.clone()),
            Refusal::Missing => (updater, 2, "Could not locate update bundle".into()),
            Refusal::Signature(why) => (
                "SQRLCodeSignatureErrorDomain",
                -1,
                format!("Code signature did not pass validation: {why}"),
            ),
            Refusal::Older => (
                updater,
                2,
                "Cannot update to a bundle with a lower version number".into(),
            ),
            Refusal::Running => (installer, -9, "App Still Running Error".into()),
            Refusal::System(it) => (
                "NSPOSIXErrorDomain",
                it.get_errno() as i32,
                string(it.name()),
            ),
        }
    }

    /// As `NSError` does.
    pub(crate) fn describe_for_log(&self) -> String {
        let (domain, code, message) = self.describe();
        format!("Error Domain={domain} Code={code} \"{message}\"")
    }
}

fn z(text: &str) -> ZBox {
    ZBox::from_bytes(text.as_bytes())
}

pub(crate) fn own() -> Option<String> {
    let executable = process::executable();
    let bundle = files::parent(&executable)?.strip_suffix("/Contents/MacOS")?;
    bundle.ends_with(".app").then(|| bundle.to_owned())
}

pub(crate) fn is_writable(path: &str) -> bool {
    bun_sys::access(&z(path), libc::W_OK).is_ok()
}

pub(crate) fn user() -> u32 {
    // SAFETY: it has no preconditions.
    unsafe { libc::getuid() }
}

/// Root must not run what the user can change. The executable is linked to libraries of the system only.
pub(crate) fn is_beyond_user(bundle: &str) -> bool {
    let user = user();
    let inside = ["", "/Contents", "/Contents/MacOS"].map(|it| format!("{bundle}{it}"));
    (inside.iter().chain([&process::executable()]))
        .all(|it| !is_writable(it) && bun_sys::lstat(&z(it)).is_ok_and(|it| it.st_uid != user))
}

pub(crate) fn is_on_read_only_volume(path: &str) -> bool {
    bun_sys::access(&z(path), libc::W_OK).is_err_and(|it| it.get_errno() == E::EROFS)
}

pub(crate) fn tool(name: &str) -> String {
    if IS_MAC {
        let directory = if matches!(name, "ps" | "rm") {
            "/bin"
        } else {
            "/usr/bin"
        };
        return format!("{directory}/{name}");
    }
    let search = bun_core::env_var::PATH::get().unwrap_or_default();
    let mut found = bun_paths::path_buffer_pool::get();
    let found = bun_which::which(&mut found, search, b"", name.as_bytes());
    found.map_or_else(String::new, |it| string(it.as_bytes()))
}

fn spawn(
    command: &[&str],
    options: &PosixSpawnOptions<'_>,
) -> Option<bun_spawn_sys::spawn_process::PosixSpawnResult> {
    let program = tool(command[0]);
    let arguments = [&[&*program], &command[1..]].concat();
    let arguments = CStringList::from_parts(arguments.iter().map(|it| [it.as_bytes()]));
    let search = match IS_MAC {
        true => b"/usr/bin:/bin:/usr/sbin:/sbin",
        false => bun_core::env_var::PATH::get().unwrap_or_default(),
    };
    let environment = CStringList::from_parts([[b"PATH=", search]].into_iter());
    (spawn_process_posix(options, arguments.as_list(), Some(environment.as_list())).ok()?).ok()
}

/// What it has printed if it has succeeded, or what it has complained of, whichever is `wanted`.
fn run(command: &[&str], wanted: Result<(), ()>) -> Result<String, String> {
    run_with(PosixStdio::Ignore, command, wanted)
}

fn run_with(stdin: PosixStdio, command: &[&str], wanted: Result<(), ()>) -> Result<String, String> {
    let stream = |is_wanted| {
        if is_wanted {
            PosixStdio::Buffer
        } else {
            PosixStdio::Ignore
        }
    };
    let options = PosixSpawnOptions {
        stdin,
        stdout: stream(wanted.is_ok()),
        stderr: stream(wanted.is_err()),
        stream: true,
        sync: true,
        ..PosixSpawnOptions::default()
    };
    let child = spawn(command, &options).ok_or_else(String::new)?;
    let (mut said, mut status) = (Vec::new(), 0);
    if let Some(stream) = child.stdout.as_ref().or(child.stderr.as_ref()) {
        let _ = stream.read_to_end_into(&mut said);
    }
    // SAFETY: it is a child of this process.
    while unsafe { libc::waitpid(child.pid, &raw mut status, 0) } < 0 {
        if bun_sys::get_errno(-1) != E::EINTR {
            return Err(String::new());
        }
    }
    let said = string(said.trim_ascii_end());
    if status == 0 { Ok(said) } else { Err(said) }
}

/// `xargs` waits for the end of its input.
pub(crate) fn run_when_gone(command: &[&str], argument: &str) {
    let options = PosixSpawnOptions {
        stdin: PosixStdio::Buffer,
        detached: true,
        sync: true,
        linux_pdeathsig: Some(0),
        ..PosixSpawnOptions::default()
    };
    let program = tool(command[0]);
    let waiting = [&["xargs", "-0", &*program], &command[1..]].concat();
    if let Some(input) = spawn(&waiting, &options).and_then(|it| it.stdin) {
        let _ = input.write_all(z(argument).as_bytes_with_nul());
        let _ = input.into_raw();
    }
}

/// What the signature of an update has to satisfy.
pub(crate) fn requirement(bundle: &str) -> Option<String> {
    let said = run(&["codesign", "-d", "-r-", bundle], Ok(())).ok()?;
    let mut lines = split(&said, "\n").map(|it| it.strip_prefix("# ").unwrap_or(it));
    let requirement = lines.find_map(|it| it.strip_prefix("designated => "))?;
    // No other build has the same hash.
    (!contains(requirement, "cdhash H\"")).then(|| requirement.to_owned())
}

fn value(bundle: &Dir, key: &str) -> Option<String> {
    let how = O::RDONLY | O::NONBLOCK | O::CLOEXEC;
    let list = File::openat(bundle.fd(), b"Contents/Info.plist", how, 0).ok()?;
    let command = ["plutil", "-extract", key, "raw", "-o", "-", "-"];
    let said = run_with(PosixStdio::Pipe(list.fd()), &command, Ok(()));
    said.ok().filter(|it| !it.is_empty())
}

/// As `NSNumericSearch` has it.
pub(crate) fn is_newer(a: &str, b: &str) -> bool {
    let parts = |text: &str| {
        let runs = (text.as_bytes()).chunk_by(|a, b| a.is_ascii_digit() && b.is_ascii_digit());
        let part = |it: &[u8]| match string(it).parse::<u64>() {
            Ok(number) => (b'0', number),
            Err(_) => (it[0], 0),
        };
        runs.map(part).collect::<Vec<_>>()
    };
    parts(a) > parts(b)
}

fn is_same(a: &Stat, b: &Stat) -> bool {
    (a.st_dev, a.st_ino) == (b.st_dev, b.st_ino)
}

fn check(new: &Dir, at: &str, bundle: &Dir, requirement: &str) -> Result<(), Refusal> {
    let requirement = format!("-R={requirement}");
    let verify = [
        "codesign",
        "--verify",
        "--deep",
        "--strict",
        &requirement,
        at,
    ];
    run(&verify, Err(())).map_err(Refusal::Signature)?;
    if !is_same(&bun_sys::lstat(&z(at))?, &bun_sys::fstat(new.fd())?) {
        return Err(Refusal::Missing);
    }
    let [new_id, id] = [new, bundle].map(|it| value(it, "CFBundleIdentifier"));
    if id.is_none() || new_id != id {
        return Err(Refusal::Missing);
    }
    if value(bundle, "ElectronSquirrelPreventDowngrades").as_deref() == Some("true") {
        let [Some(new), Some(old)] =
            [new, bundle].map(|it| value(it, "CFBundleShortVersionString"))
        else {
            return Err(Refusal::Older);
        };
        let is_number = |it: &str| !it.is_empty() && it.bytes().all(|it| it.is_ascii_digit());
        let is_plain = |it| split(it, ".").count() == 3 && split(it, ".").all(is_number);
        if !is_plain(&new) || !is_plain(&old) || is_newer(&old, &new) {
            return Err(Refusal::Older);
        }
    }
    Ok(())
}

/// But for the process `except` and its children.
pub(crate) fn is_running(bundle: &str, except: u32) -> bool {
    let all = run(&["ps", "-axo", "pid=,ppid=,comm="], Ok(())).unwrap_or_default();
    let (executables, except) = (format!("{bundle}/Contents/MacOS/"), except.to_string());
    let (this, mut lines) = (process::id().to_string(), split(&all, "\n"));
    lines.any(|line| {
        let (id, rest) = split_once(line.trim_start(), " ").unwrap_or_default();
        let (parent, command) = split_once(rest.trim_start(), " ").unwrap_or_default();
        command.trim_start().starts_with(&executables)
            && ![&*except, &*this].contains(&id)
            && parent != except
    })
}

fn open_in(parent: &Dir, name: &[u8]) -> bun_sys::Result<Dir> {
    parent.open_at_with(name, O::NOFOLLOW)
}

pub(crate) fn archive_in(directory: &str) -> String {
    files::join(&[directory, ARCHIVE])
}

/// Of the archive. No name from it is kept.
pub(crate) fn unpack(directory: &str, bundle: &str, requirement: &str) -> Result<(), Refusal> {
    let (place, unpacked) = (
        Dir::open(directory.as_bytes())?,
        format!("{directory}/unpacked"),
    );
    run(
        &["ditto", "-xk", &archive_in(directory), &unpacked],
        Err(()),
    )
    .map_err(Refusal::Archive)?;
    place.delete_tree(ARCHIVE.as_bytes())?;
    let (contents, bundle) = (open_in(&place, b"unpacked")?, Dir::open(bundle.as_bytes())?);
    let id = value(&bundle, "CFBundleIdentifier");
    let is_it = |name: &String| {
        name.ends_with(".app")
            && open_in(&contents, name.as_bytes())
                .is_ok_and(|it| value(&it, "CFBundleIdentifier") == id)
    };
    let name = (files::names_in(&unpacked).into_iter().find(is_it)).ok_or(Refusal::Missing)?;
    bun_sys::renameat(contents.fd(), &z(&name), place.fd(), &z(STAGED))?;
    place.delete_tree(b"unpacked")?;
    let new = open_in(&place, STAGED.as_bytes())?;
    check(&new, &format!("{directory}/{STAGED}"), &bundle, requirement)
}

#[cfg(target_os = "macos")]
fn copy_contents(from: &File, to: &File) -> bun_sys::Result<()> {
    let (from, to) = (from.fd().native(), to.fd().native());
    let what = libc::COPYFILE_DATA | libc::COPYFILE_XATTR;
    // SAFETY: both are open.
    let result = unsafe { libc::fcopyfile(from, to, core::ptr::null_mut(), what) };
    if result != 0 {
        let code = bun_sys::get_errno(result);
        return Err(bun_sys::Error::from_code(code, bun_sys::Tag::copyfile));
    }
    // SAFETY: as above.
    unsafe { libc::fremovexattr(to, c"com.apple.quarantine".as_ptr(), 0) };
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn copy_contents(from: &File, to: &File) -> bun_sys::Result<()> {
    bun_sys::copy_file(from.fd(), to.fd())
}

struct Owners {
    /// A hard link must not make root disclose the file of somebody else.
    of_source: Option<u32>,
    of_copy: Stat,
}

/// Nothing is followed, and only the owner can write to the copy.
fn copy(from: &Dir, parent: &Dir, name: &[u8], owners: &Owners, depth: u8) -> bun_sys::Result<Dir> {
    let owner = &owners.of_copy;
    let give = |fd| match bun_sys::fchown(fd, owner.st_uid, owner.st_gid) {
        Err(error) if error.get_errno() != E::EPERM => Err(error),
        _ => Ok(()),
    };
    let unfit = || bun_sys::Error::from_code(E::EINVAL, bun_sys::Tag::copyfile);
    bun_sys::mkdirat(parent.fd(), &ZBox::from_bytes(name), 0o700)?;
    let to = open_in(parent, name)?;
    let mut entries = bun_sys::dir_iterator::iterate(from.fd());
    while let Some(entry) = entries.next()? {
        let name = ZBox::from_bytes(entry.name.slice_u8());
        let how = O::RDONLY | O::NOFOLLOW | O::NONBLOCK;
        let source = match File::openat(from.fd(), name.as_bytes(), how, 0) {
            Err(error) if error.get_errno() == E::ELOOP => {
                let mut target = bun_paths::path_buffer_pool::get();
                let length = bun_sys::readlinkat(from.fd(), &name, &mut target[..])?;
                bun_sys::symlinkat(&ZBox::from_bytes(&target[..length]), to.fd(), &name)?;
                continue;
            }
            opened => opened?,
        };
        let Stat {
            st_mode: mode,
            st_uid,
            ..
        } = source.stat()?;
        match mode & libc::S_IFMT {
            _ if owners.of_source.is_some_and(|it| it != st_uid) => return Err(unfit()),
            libc::S_IFDIR if depth < 64 => {
                let source = Dir::from_fd(source.into_raw());
                copy(&source, &to, name.as_bytes(), owners, depth + 1)?;
            }
            libc::S_IFREG => {
                let how = O::WRONLY | O::CREAT | O::EXCL | O::NOFOLLOW;
                let file = File::openat(to.fd(), name.as_bytes(), how, 0o600)?;
                copy_contents(&source, &file)?;
                give(file.fd())?;
                bun_sys::fchmod(file.fd(), (mode & 0o755 | 0o644) as bun_sys::Mode)?;
            }
            _ => return Err(unfit()),
        }
    }
    give(to.fd())?;
    bun_sys::fchmod(to.fd(), 0o755)?;
    Ok(to)
}

/// A directory that nobody else can enter.
struct Work<'a> {
    place: &'a Dir,
    name: String,
    directory: Dir,
    is_kept: bool,
}

impl<'a> Work<'a> {
    fn new(place: &'a Dir) -> bun_sys::Result<Work<'a>> {
        let name = format!(".update.{:x}", u64::from_ne_bytes(random_bytes()));
        bun_sys::mkdirat(place.fd(), &z(&name), 0o700)?;
        let directory = open_in(place, name.as_bytes())?;
        let made = bun_sys::fstat(directory.fd())?;
        // SAFETY: it has no preconditions.
        if made.st_uid != unsafe { libc::geteuid() } || made.st_mode & 0o077 != 0 {
            return Err(bun_sys::Error::from_code(E::EPERM, bun_sys::Tag::mkdir));
        }
        Ok(Work {
            place,
            name,
            directory,
            is_kept: false,
        })
    }
}

impl Drop for Work<'_> {
    fn drop(&mut self) {
        if !self.is_kept && self.directory.delete_children().is_ok() {
            let _ = bun_sys::rmdirat(self.place.fd(), &z(&self.name));
        }
    }
}

/// With what `unpack` has left in `directory` as `user`. `app` is the process that is about to end.
pub(crate) fn install(
    directory: &str,
    requirement: &str,
    app: u32,
    user: u32,
    is_only_thread: bool,
) -> Result<(), Refusal> {
    let bundle = own().ok_or(Refusal::Missing)?;
    let staged = open_in(&Dir::open(directory.as_bytes())?, STAGED.as_bytes())?;
    let parent = files::parent(&bundle).ok_or(Refusal::Missing)?;
    let is_whole = is_writable(parent);
    let (path, target) = match is_whole {
        true => (parent, z(files::name(&bundle))),
        false => (&*bundle, z("Contents")),
    };
    let place = Dir::open(path.as_bytes())?;
    let (mut work, replaced) = (Work::new(&place)?, open_in(&place, target.as_bytes())?);
    let owners = Owners {
        of_source: Some(user),
        of_copy: bun_sys::fstat(replaced.fd())?,
    };
    let new = copy(&staged, &work.directory, STAGED.as_bytes(), &owners, 0)?;
    let at = if is_only_thread {
        bun_sys::fchdir(work.directory.fd())?;
        format!("./{STAGED}")
    } else {
        format!("{path}/{}/{STAGED}", work.name)
    };
    let installed = if is_whole { &replaced } else { &place };
    check(&new, &at, installed, requirement)?;
    if is_running(&bundle, app) {
        return Err(Refusal::Running);
    }
    let (from, name) = match is_whole {
        true => (work.directory.fd(), z(STAGED)),
        false => (new.fd(), z("Contents")),
    };
    let is_at = |what: &Dir, directory, name| {
        let [found, wanted] = [bun_sys::lstatat(directory, name), bun_sys::fstat(what.fd())];
        matches!((found, wanted), (Ok(a), Ok(b)) if is_same(&a, &b))
    };
    let exchange = || bun_sys::renameat2(from, &name, place.fd(), &target, RenameMode::Exchange);
    match exchange() {
        Err(it) if matches!(it.get_errno(), E::ENOTSUP | E::EINVAL | E::ENOSYS) => {}
        Err(it) => return Err(it.into()),
        Ok(()) if is_at(&replaced, from, &name) => return Ok(()),
        Ok(()) => {
            // Somebody has given the name to something else.
            let _ = exchange();
            work.is_kept = true;
            return Err(Refusal::Missing);
        }
    }
    let old = zstr!("old");
    bun_sys::renameat(place.fd(), &target, work.directory.fd(), old)?;
    let result = match is_at(&replaced, work.directory.fd(), old) {
        true => bun_sys::renameat(from, &name, place.fd(), &target).map_err(Refusal::from),
        false => Err(Refusal::Missing),
    };
    if result.is_err() {
        work.is_kept = bun_sys::renameat(work.directory.fd(), old, place.fd(), &target).is_err();
    }
    result
}

/// It prints why it has failed. What is replaced, and what it takes for that, is not up to whoever starts it.
///
/// # Safety
/// They are C strings.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Desktop__installUpdate(
    directory: *const c_char,
    app: *const c_char,
) -> bool {
    let user = user();
    // SAFETY: the caller's contract, and it has no preconditions.
    let [directory, app] = unsafe {
        if libc::geteuid() != 0 || libc::setuid(0) != 0 {
            return false;
        }
        [directory, app].map(|it| string(core::ffi::CStr::from_ptr(it).to_bytes()))
    };
    let result = match own().and_then(|it| requirement(&it)) {
        Some(requirement) => install(
            &directory,
            &requirement,
            app.parse().unwrap_or(0),
            user,
            true,
        ),
        None => Err(Refusal::Missing),
    };
    let is_done = result.is_ok();
    let said = result.map_or_else(|it| it.describe_for_log(), |()| "done".into());
    let _ = bun_sys::write(bun_sys::Fd::stdout(), said.as_bytes());
    is_done
}

/// There is nothing of that name.
pub(crate) fn copy_to(source: &str, directory: &str) -> bun_sys::Result<()> {
    let place = Dir::open(directory.as_bytes())?;
    let (from, work) = (Dir::open(source.as_bytes())?, Work::new(&place)?);
    let owners = Owners {
        of_source: None,
        of_copy: bun_sys::fstat(work.directory.fd())?,
    };
    copy(&from, &work.directory, STAGED.as_bytes(), &owners, 0)?;
    let (new, name) = (z(STAGED), z(files::name(source)));
    bun_sys::renameat2(
        work.directory.fd(),
        &new,
        place.fd(),
        &name,
        RenameMode::NoReplace,
    )
}

/// The device, if it is on a disk image.
#[cfg(target_os = "macos")]
pub(crate) fn image_with(path: &str) -> Option<String> {
    let name = bun_sys::statfs(&z(path)).ok()?.f_mntfromname;
    let name = name.iter().take_while(|it| **it != 0).map(|it| *it as u8);
    let device = string(&name.collect::<Vec<_>>());
    let images = run(&["hdiutil", "info"], Ok(())).ok()?;
    let is_listed =
        split(&images, "\n").any(|it| it.split_ascii_whitespace().next() == Some(&device));
    (device.starts_with("/dev/") && is_listed).then_some(device)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn image_with(_: &str) -> Option<String> {
    None
}

pub(crate) fn remove(bundle: &str) {
    let parent = files::parent(bundle).and_then(|it| Dir::open(it.as_bytes()).ok());
    let _ = parent.map(|it| it.delete_tree(files::name(bundle).as_bytes()));
}

pub(crate) fn log(file: &str, message: &str) {
    let now = bun_web::time::wall_now();
    let mut it: libc::tm = bun_core::ffi::zeroed();
    // SAFETY: it fills in the structure.
    unsafe { libc::localtime_r(&(now as _), &raw mut it) };
    let line = format!(
        "{}-{:02}-{:02} {:02}:{:02}:{:02}.{:03} ShipIt[{}] {message}\n",
        it.tm_year + 1900,
        it.tm_mon + 1,
        it.tm_mday,
        it.tm_hour,
        it.tm_min,
        it.tm_sec,
        (now.fract() * 1e3) as u32,
        process::id(),
    );
    let how = O::WRONLY | O::CREAT | O::APPEND | O::NOFOLLOW;
    let file = File::openat(bun_sys::Fd::cwd(), file.as_bytes(), how, 0o600);
    let _ = file.and_then(|it| it.write_all(line.as_bytes()));
}
