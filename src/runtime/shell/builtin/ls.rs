use core::sync::atomic::{AtomicUsize, Ordering};
use std::io::Write as _;

use bun_core::ZBox;
use bun_ptr::BackRef;
use bun_sys::{E, O, S, dir_iterator};

use crate::shell::builtin::{BadFlag, Builtin, Kind};
use crate::shell::builtins::batch::Batch;
use crate::shell::interpreter::{
    Interpreter, NodeId, PoolTask, ShellTask, ShellWork, shell_lstatat, shell_openat, shell_statat,
};
use crate::shell::yield_::Yield;

pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
    let (flags, paths) = Builtin::of(interp, cmd).split_flags();
    let mut opts = Opts::default();
    if let Err(flag) = flags.iter().try_for_each(|flag| opts.parse(flag)) {
        return Builtin::fail_flag(interp, cmd, flag);
    }
    Batch::start(interp, cmd, paths.len().max(1));
    let running = BackRef::new(&Builtin::of(interp, cmd).running);
    let cwd = Builtin::cwd(interp, cmd);
    let schedule = |path: &[u8]| {
        let path = ZBox::from_bytes(path);
        let task = ShellLsTask::new(cmd, opts, paths.len() > 1, running, cwd, path);
        PoolTask::schedule_no_ref(interp, task);
    };
    if paths.is_empty() {
        schedule(b".");
    }
    for path in paths {
        schedule(path);
    }
    Yield::suspended()
}

/// Opens the path, iterates its entries (or
/// prints the path itself for files / `-d`), accumulating into `output`.
pub(crate) struct ShellLsTask {
    pub cmd: NodeId,
    pub opts: Opts,
    pub print_directory: bool,
    /// [`Builtin::running`]
    pub running: BackRef<AtomicUsize>,
    pub cwd: bun_sys::Fd,
    pub path: ZBox,
    pub output: Vec<u8>,
    pub err: Option<bun_sys::Error>,
    /// Cached current time (seconds since epoch) for formatting timestamps.
    /// Cached once per task to avoid repeated syscalls.
    now_secs: u64,
}

impl ShellLsTask {
    fn new(
        cmd: NodeId,
        opts: Opts,
        print_directory: bool,
        running: BackRef<AtomicUsize>,
        cwd: bun_sys::Fd,
        path: ZBox,
    ) -> Self {
        Self {
            cmd,
            opts,
            print_directory,
            running,
            cwd,
            path,
            output: Vec::new(),
            err: None,
            now_secs: 0,
        }
    }

    /// Spawns a subtask for a recursively
    /// discovered subdirectory.
    fn enqueue(&self, task: &ShellTask, name: &[u8]) {
        let path = self.join(name);
        let subtask = Self::new(self.cmd, self.opts, true, self.running, self.cwd, path);
        self.running.fetch_add(1, Ordering::Relaxed);
        PoolTask::schedule_child(task, subtask);
    }

    /// Does not normalize the path.
    fn join(&self, child: &[u8]) -> ZBox {
        let parent = self.path.as_bytes();
        let mut v = Vec::with_capacity(parent.len() + 1 + child.len());
        v.extend_from_slice(parent);
        if parent.last().is_some_and(|&c| !bun_paths::is_sep_native(c)) {
            v.push(bun_paths::SEP);
        }
        v.extend_from_slice(child);
        ZBox::from_vec(v)
    }

    fn list(this: &mut ShellLsTask, task: &ShellTask) {
        // Cache current time once per task for timestamp formatting.
        if this.opts.long_listing {
            this.now_secs = bun_core::time::timestamp().max(0) as u64;
        }

        let dir = match shell_openat(this.cwd, this.path.as_zstr(), O::RDONLY | O::DIRECTORY, 0) {
            Err(open_err) => {
                this.list_non_directory_operand(&open_err);
                return;
            }
            Ok(fd) => bun_sys::File::from_fd(fd),
        };
        let fd = dir.fd();

        if !this.opts.list_directories {
            if this.print_directory {
                this.output.extend_from_slice(this.path.as_bytes());
                this.output.extend_from_slice(b":\n");
            }

            let mut iterator = dir_iterator::iterate(fd);

            // If `-a` is used, "." and ".." should show up as results. However,
            // our `DirIterator` abstraction skips them, so add them now.
            this.add_dot_entries_if_needed(fd);

            loop {
                match iterator.next() {
                    Err(e) => {
                        this.err = Some(this.error_with_path(&e));
                        return;
                    }
                    Ok(None) => break,
                    Ok(Some(current)) => {
                        let name = current.name.slice_u8();
                        this.add_entry(name, fd);
                        if matches!(current.kind, bun_sys::EntryKind::Directory)
                            && this.opts.recursive
                        {
                            this.enqueue(task, name);
                        }
                    }
                }
            }
            return;
        }

        this.output.extend_from_slice(this.path.as_bytes());
        this.output.push(b'\n');
    }

    /// coreutils operand rule: `stat`, and on ENOENT or ELOOP `lstat` so a symlink is itself.
    fn list_non_directory_operand(&mut self, open_err: &bun_sys::Error) {
        match shell_statat(self.cwd, self.path.as_zstr()) {
            // A directory that would not open: report the open error.
            Ok(stat) if S::ISDIR(stat.st_mode as _) => {
                self.err = Some(self.error_with_path(open_err));
                return;
            }
            Ok(_) => {}
            Err(e) if matches!(e.get_errno(), E::ENOENT | E::ELOOP) => {}
            Err(e) => {
                self.err = Some(self.error_with_path(&e));
                return;
            }
        }
        match shell_lstatat(self.cwd, self.path.as_zstr()) {
            Ok(stat) => {
                // An operand is never subject to the -a/-A filter.
                let name = ZBox::from_bytes(self.path.as_bytes());
                if self.opts.long_listing {
                    self.add_entry_long_from_stat(name.as_bytes(), &stat);
                } else {
                    self.add_entry_short(name.as_bytes());
                }
            }
            Err(e) => self.err = Some(self.error_with_path(&e)),
        }
    }

    fn should_skip_entry(&self, name: &[u8]) -> bool {
        match self.opts.dotfiles {
            DotfileMode::All => false,
            DotfileMode::AlmostAll => name == b"." || name == b"..",
            DotfileMode::Hide => name.first() == Some(&b'.'),
        }
    }

    // TODO more complex output like multi-column
    fn add_entry(&mut self, name: &[u8], dir_fd: bun_sys::Fd) {
        if self.should_skip_entry(name) {
            return;
        }
        if self.opts.long_listing {
            self.add_entry_long(name, dir_fd);
        } else {
            self.add_entry_short(name);
        }
    }

    fn add_entry_short(&mut self, name: &[u8]) {
        self.output.reserve(name.len() + 1);
        self.output.extend_from_slice(name);
        self.output.push(b'\n');
    }

    fn add_entry_long(&mut self, name: &[u8], dir_fd: bun_sys::Fd) {
        // Use lstatat to not follow symlinks (so symlinks show as 'l' type).
        let name_z = ZBox::from_bytes(name);
        match bun_sys::lstatat(dir_fd, name_z.as_zstr()) {
            Err(_) => {
                // If stat fails, just output the name with placeholders.
                self.output
                    .extend_from_slice(b"?????????? ? ? ? ?            ? ");
                self.output.extend_from_slice(name);
                self.output.push(b'\n');
            }
            Ok(stat) => self.add_entry_long_from_stat(name, &stat),
        }
    }

    fn add_entry_long_from_stat(&mut self, name: &[u8], stat: &bun_sys::Stat) {
        // File type and permissions.
        let mode: u32 = stat.st_mode as u32;
        let file_type = get_file_type_char(mode);
        let perms = format_permissions(mode);

        // Number of hard links.
        let nlink: u64 = stat.st_nlink as u64;

        // Owner and group (numeric).
        let uid: u64 = stat.st_uid as u64;
        let gid: u64 = stat.st_gid as u64;

        // File size.
        let size: i64 = stat.st_size as i64;

        // Modification time.
        let mtime = bun_sys::stat_mtime(stat);
        let time_str = format_time(mtime.sec, self.now_secs);

        self.output.push(file_type);
        self.output.extend_from_slice(&perms);
        let _ = write!(
            self.output,
            " {:>3} {:>5} {:>5} {:>8} ",
            nlink, uid, gid, size,
        );
        self.output.extend_from_slice(&time_str);
        self.output.push(b' ');
        self.output.extend_from_slice(name);
        self.output.push(b'\n');
    }

    fn add_dot_entries_if_needed(&mut self, dir_fd: bun_sys::Fd) {
        // `add_entry()` already checks if we can add "." and ".." to the result.
        self.add_entry(b".", dir_fd);
        self.add_entry(b"..", dir_fd);
    }

    fn error_with_path(&self, err: &bun_sys::Error) -> bun_sys::Error {
        err.with_path(self.path.as_bytes())
    }
}

fn get_file_type_char(mode: u32) -> u8 {
    let file_type = mode & (S::IFMT as u32);
    match file_type {
        x if x == S::IFDIR as u32 => b'd',
        x if x == S::IFLNK as u32 => b'l',
        x if x == S::IFBLK as u32 => b'b',
        x if x == S::IFCHR as u32 => b'c',
        x if x == S::IFIFO as u32 => b'p',
        x if x == S::IFSOCK as u32 => b's',
        _ => b'-', // IFREG or unknown
    }
}

fn format_permissions(mode: u32) -> [u8; 9] {
    let has = |bit| mode & (bit as u32) != 0;
    let triple = |read, write, exec, special, letter: u8| {
        [
            if has(read) { b'r' } else { b'-' },
            if has(write) { b'w' } else { b'-' },
            match (has(special), has(exec)) {
                (true, true) => letter,
                (true, false) => letter.to_ascii_uppercase(),
                (false, true) => b'x',
                (false, false) => b'-',
            },
        ]
    };
    let [a, b, c] = triple(S::IRUSR, S::IWUSR, S::IXUSR, S::ISUID, b's');
    let [d, e, f] = triple(S::IRGRP, S::IWGRP, S::IXGRP, S::ISGID, b's');
    let [g, h, i] = triple(S::IROTH, S::IWOTH, S::IXOTH, S::ISVTX, b't');
    [a, b, c, d, e, f, g, h, i]
}

/// Format as `"Mon DD HH:MM"` for recent files
/// (within ~6 months) or `"Mon DD  YYYY"` for older files.
fn format_time(timestamp: i64, now_secs: u64) -> [u8; 12] {
    const MONTH_NAMES: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let mut buf = *b"??? ?? ??:??";
    let epoch_secs: u64 = if timestamp < 0 { 0 } else { timestamp as u64 };

    let secs_of_day = (epoch_secs % 86_400) as u32;
    let days = (epoch_secs / 86_400) as i64;
    let (year, month, day) = civil_from_days(days);
    let month_name = MONTH_NAMES[(month as usize).saturating_sub(1).min(11)];

    // Check if file is older than 6 months (approximately 180 days).
    const SIX_MONTHS_SECS: u64 = 180 * 24 * 60 * 60;
    let is_recent = epoch_secs > now_secs.saturating_sub(SIX_MONTHS_SECS)
        && epoch_secs <= now_secs.saturating_add(SIX_MONTHS_SECS);

    if is_recent {
        let hours = secs_of_day / 3600;
        let minutes = (secs_of_day / 60) % 60;
        let _ = bun_core::fmt::buf_print(
            &mut buf[..],
            format_args!("{} {:02} {:02}:{:02}", month_name, day, hours, minutes),
        );
    } else {
        // Show year for old files.
        let _ = bun_core::fmt::buf_print(
            &mut buf[..],
            format_args!("{} {:02}  {:4}", month_name, day, year),
        );
    }
    buf
}

/// Howard Hinnant's `civil_from_days` — converts days-since-1970-01-01 to a
/// proleptic-Gregorian (year, month[1..=12], day[1..=31]).
fn civil_from_days(z: i64) -> (i32, u8, u8) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = (z - era * 146_097) as u32; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u8; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u8; // [1, 12]
    ((y + (m <= 2) as i64) as i32, m, d)
}

impl ShellWork for ShellLsTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellLsTask;
    fn run_from_thread_pool(&mut self, task: &ShellTask) {
        Self::list(self, task)
    }
    fn run_from_main_thread(&mut self, interp: &Interpreter) -> Yield {
        let err = self.err.as_ref().map(|e| Kind::Ls.task_error(e));
        Batch::report(interp, self.cmd, err, core::mem::take(&mut self.output))
    }
}

/// `-a` vs `-A`; the last one on the command line wins (GNU coreutils).
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum DotfileMode {
    #[default]
    Hide,
    /// `-A`, `--almost-all` — show dotfiles but skip `.` and `..`.
    AlmostAll,
    /// `-a`, `--all` — show everything including `.` and `..`.
    All,
}

/// Only the fields actually consulted are kept; the rest are recognised by
/// `parse` but not stored.
#[derive(Clone, Copy, Default)]
pub(crate) struct Opts {
    pub(crate) dotfiles: DotfileMode,
    /// `-d`, `--directory` — list directories themselves, not their contents
    pub(crate) list_directories: bool,
    /// `-l` — use a long listing format
    pub(crate) long_listing: bool,
    /// `-R`, `--recursive` — list subdirectories recursively
    pub(crate) recursive: bool,
}

impl Opts {
    fn parse<'a>(&mut self, flag: &'a [u8]) -> Result<(), BadFlag<'a>> {
        let [_, first, ..] = flag else {
            return Err(BadFlag::Illegal(flag));
        };
        for &ch in flag.iter().skip(1) {
            match ch {
                b'a' => self.dotfiles = DotfileMode::All,
                b'A' => self.dotfiles = DotfileMode::AlmostAll,
                b'd' => self.list_directories = true,
                b'l' => self.long_listing = true,
                b'R' => self.recursive = true,
                // The remaining short flags are recognised but currently no-op.
                b'r' | b'1' | b'b' | b'B' | b'c' | b'C' | b'D' | b'f' | b'F' | b'g' | b'G'
                | b'h' | b'H' | b'i' | b'I' | b'k' | b'L' | b'm' | b'n' | b'N' | b'o' | b'p'
                | b'q' | b'Q' | b's' | b'S' | b't' | b'T' | b'u' | b'U' | b'v' | b'w' | b'x'
                | b'X' | b'Z' => {}
                _ => return Err(BadFlag::Illegal(core::slice::from_ref(first))),
            }
        }
        Ok(())
    }
}
