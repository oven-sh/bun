use std::os::unix::fs::MetadataExt as _;
use std::sync::atomic::{AtomicBool, Ordering};

use libc::*;

#[derive(Clone, Copy)]
enum Condition {
    /// The argument, and with it what counts of it.
    OneOf(u32, u32, &'static [c_int]),
    Is(u32, u32),
    NoBitsBut(u32, c_int),
    NotAllOf(u32, c_int),
    Above(u32, u32),
    AtMost(u32, u32),
    IsNull(u32),
}

use Condition::*;

const ALL: u32 = !0;
/// Not the terminal, or whatever else has been inherited as such.
const NOT_STANDARD: Condition = Above(0, 2);
/// PROT_BTI and PROT_MTE.
const OF_ARM: c_int = 0x30;
const OF_THREADS: c_int = CLONE_VM
    | CLONE_FS
    | CLONE_FILES
    | CLONE_SIGHAND
    | CLONE_THREAD
    | CLONE_SYSVSEM
    | CLONE_SETTLS
    | CLONE_PARENT_SETTID
    | CLONE_CHILD_CLEARTID;
const MAP_DROPPABLE: c_int = 8;
const OF_MAPPINGS: c_int = MAP_SHARED
    | MAP_PRIVATE
    | MAP_ANONYMOUS
    | MAP_FIXED
    | MAP_FIXED_NOREPLACE
    | MAP_NORESERVE
    | MAP_POPULATE
    | MAP_STACK
    | MAP_DROPPABLE;
const MADV_GUARD_INSTALL: c_int = 102;
const MADV_GUARD_REMOVE: c_int = 103;
const SYS_MSEAL: c_long = 462;

const FREE: &[c_long] = &[
    SYS_brk,
    SYS_clock_getres,
    SYS_close,
    SYS_epoll_create1,
    SYS_epoll_ctl,
    SYS_epoll_pwait,
    SYS_epoll_pwait2,
    #[cfg(target_arch = "x86_64")]
    SYS_epoll_wait,
    SYS_eventfd2,
    SYS_exit,
    SYS_exit_group,
    SYS_fstat,
    SYS_getcpu,
    SYS_getegid,
    SYS_geteuid,
    SYS_getgid,
    SYS_getpid,
    SYS_getppid,
    SYS_getrandom,
    SYS_getrusage,
    SYS_gettid,
    SYS_gettimeofday,
    SYS_getuid,
    SYS_membarrier,
    SYS_mincore,
    SYS_mremap,
    SYS_MSEAL,
    SYS_munmap,
    SYS_nanosleep,
    SYS_pkey_alloc,
    SYS_pkey_free,
    #[cfg(target_arch = "x86_64")]
    SYS_poll,
    SYS_ppoll,
    SYS_restart_syscall,
    SYS_rseq,
    SYS_rt_sigaction,
    SYS_rt_sigprocmask,
    SYS_rt_sigreturn,
    SYS_rt_sigsuspend,
    SYS_rt_sigtimedwait,
    SYS_sched_yield,
    SYS_set_robust_list,
    SYS_set_tid_address,
    SYS_sigaltstack,
    SYS_sysinfo,
    #[cfg(target_arch = "x86_64")]
    SYS_time,
    SYS_timerfd_create,
    SYS_timerfd_gettime,
    SYS_timerfd_settime,
    SYS_uname,
    SYS_write,
    SYS_writev,
];

const ON_DESCRIPTORS: &[c_long] = &[
    SYS_fdatasync,
    SYS_fsync,
    SYS_ftruncate,
    SYS_lseek,
    SYS_pread64,
    SYS_pwrite64,
    SYS_read,
    SYS_readv,
    SYS_shutdown,
];

/// The C library has another way.
const UNKNOWN: &[c_long] = &[SYS_clone3, SYS_statx];

const LIMITED: &[(c_long, c_int, &[Condition])] = &[
    (
        SYS_futex,
        EPERM,
        &[OneOf(
            1,
            !(FUTEX_PRIVATE_FLAG | FUTEX_CLOCK_REALTIME) as u32,
            &[
                FUTEX_WAKE,
                FUTEX_WAIT_BITSET,
                FUTEX_WAIT,
                FUTEX_WAKE_BITSET,
                FUTEX_REQUEUE,
                FUTEX_CMP_REQUEUE,
            ],
        )],
    ),
    (
        SYS_madvise,
        EINVAL,
        &[OneOf(
            2,
            ALL,
            &[
                MADV_DONTNEED,
                MADV_FREE,
                MADV_WILLNEED,
                MADV_NORMAL,
                MADV_RANDOM,
                MADV_SEQUENTIAL,
                MADV_DONTFORK,
                MADV_DOFORK,
                MADV_HUGEPAGE,
                MADV_NOHUGEPAGE,
                MADV_DONTDUMP,
                MADV_DODUMP,
                MADV_WIPEONFORK,
                MADV_POPULATE_READ,
                MADV_POPULATE_WRITE,
                MADV_GUARD_INSTALL,
                MADV_GUARD_REMOVE,
            ],
        )],
    ),
    (
        SYS_recvmsg,
        EPERM,
        &[NOT_STANDARD, NoBitsBut(2, MSG_DONTWAIT | MSG_CMSG_CLOEXEC)],
    ),
    (
        SYS_recvfrom,
        EPERM,
        &[NOT_STANDARD, NoBitsBut(3, MSG_DONTWAIT), IsNull(4)],
    ),
    (
        SYS_sendto,
        EPERM,
        &[
            NOT_STANDARD,
            NoBitsBut(3, MSG_DONTWAIT | MSG_NOSIGNAL),
            IsNull(4),
        ],
    ),
    (SYS_pipe2, EPERM, &[NoBitsBut(1, O_CLOEXEC | O_NONBLOCK)]),
    (SYS_clock_gettime, EINVAL, &[AtMost(0, CLOCK_TAI as u32)]),
    (SYS_clock_nanosleep, EINVAL, &[AtMost(0, CLOCK_TAI as u32)]),
    (
        SYS_clone,
        EPERM,
        &[OneOf(0, !CLONE_DETACHED as u32, &[OF_THREADS])],
    ),
    (
        SYS_prctl,
        EINVAL,
        &[OneOf(
            0,
            ALL,
            &[PR_SET_NAME, PR_GET_NAME, PR_SET_VMA, PR_SET_TIMERSLACK],
        )],
    ),
    (
        SYS_fcntl,
        EPERM,
        &[
            NOT_STANDARD,
            OneOf(
                1,
                ALL,
                &[F_GETFD, F_SETFD, F_GETFL, F_SETFL, F_DUPFD, F_DUPFD_CLOEXEC],
            ),
        ],
    ),
    (
        SYS_ioctl,
        ENOTTY,
        &[
            NOT_STANDARD,
            OneOf(
                1,
                ALL,
                &[FIONBIO as c_int, FIONREAD as c_int, FIOCLEX as c_int],
            ),
        ],
    ),
    (SYS_sched_getaffinity, ENOSYS, &[Is(0, 0)]),
    (SYS_prlimit64, EPERM, &[Is(0, 0), IsNull(2)]),
];

const ALLOW: u32 = SECCOMP_RET_ALLOW;
/// Stands for the distance to the last instruction of a rule.
const REFUSAL: u8 = u8::MAX;

#[derive(Default)]
struct Program(Vec<sock_filter>);

impl Program {
    fn add(&mut self, code: u32, k: u32, jt: u8, jf: u8) {
        let code = code as u16;
        self.0.push(sock_filter { code, jt, jf, k });
    }

    fn load(&mut self, offset: u32) {
        self.add(BPF_LD | BPF_W | BPF_ABS, offset, 0, 0);
    }

    fn jump(&mut self, test: u32, k: u32, jt: u8, jf: u8) {
        self.add(BPF_JMP | test | BPF_K, k, jt, jf);
    }

    fn end(&mut self, action: u32) {
        self.add(BPF_RET | BPF_K, action, 0, 0);
    }

    fn require(&mut self, condition: Condition) {
        let (OneOf(argument, ..)
        | Is(argument, _)
        | NoBitsBut(argument, _)
        | NotAllOf(argument, _)
        | Above(argument, _)
        | AtMost(argument, _)
        | IsNull(argument)) = condition;
        let low_half = std::mem::offset_of!(seccomp_data, args) as u32 + argument * 8;
        self.load(low_half);
        match condition {
            OneOf(_, mask, values) => {
                self.add(BPF_ALU | BPF_AND | BPF_K, mask, 0, 0);
                for (left, value) in (0..values.len() as u8).rev().zip(values) {
                    let otherwise = if left == 0 { REFUSAL } else { 0 };
                    self.jump(BPF_JEQ, *value as u32, left, otherwise);
                }
            }
            Is(_, value) => self.jump(BPF_JEQ, value, 0, REFUSAL),
            NoBitsBut(_, bits) => self.jump(BPF_JSET, !bits as u32, REFUSAL, 0),
            NotAllOf(_, bits) => {
                self.add(BPF_ALU | BPF_AND | BPF_K, bits as u32, 0, 0);
                self.jump(BPF_JEQ, bits as u32, REFUSAL, 0);
            }
            Above(_, value) => self.jump(BPF_JGT, value, 0, REFUSAL),
            AtMost(_, value) => self.jump(BPF_JGT, value, REFUSAL, 0),
            IsNull(_) => {
                self.jump(BPF_JEQ, 0, 0, REFUSAL);
                self.load(low_half + 4);
                self.jump(BPF_JEQ, 0, 0, REFUSAL);
            }
        }
    }

    fn limit(&mut self, call: c_long, error: c_int, conditions: &[Condition]) {
        let mut rule = Program::default();
        conditions.iter().for_each(|it| rule.require(*it));
        rule.end(ALLOW);
        rule.end(SECCOMP_RET_ERRNO | error as u32);
        let length = rule.0.len() as u8;
        for (it, to_refusal) in rule.0.iter_mut().zip((0..length - 1).rev()) {
            for distance in [&mut it.jt, &mut it.jf] {
                if *distance == REFUSAL {
                    *distance = to_refusal;
                }
            }
        }
        self.jump(BPF_JEQ, call as u32, 0, length);
        self.0.append(&mut rule.0);
    }

    fn always(&mut self, calls: &[c_long], action: u32) {
        for call in calls {
            self.jump(BPF_JEQ, *call as u32, 0, 1);
            self.end(action);
        }
    }
}

fn filter(own: u32, generates_code: bool) -> Program {
    #[cfg(target_arch = "x86_64")]
    const ARCHITECTURE: u32 = 0xc000_003e;
    #[cfg(target_arch = "aarch64")]
    const ARCHITECTURE: u32 = 0xc000_00b7;
    const OF_X32: u32 = 0x4000_0000;
    let mut it = Program::default();
    it.load(std::mem::offset_of!(seccomp_data, arch) as u32);
    it.jump(BPF_JEQ, ARCHITECTURE, 1, 0);
    it.end(SECCOMP_RET_KILL_PROCESS);
    it.load(std::mem::offset_of!(seccomp_data, nr) as u32);
    it.jump(BPF_JGE, OF_X32, 0, 1);
    it.end(SECCOMP_RET_KILL_PROCESS);
    for (call, error, conditions) in LIMITED {
        it.limit(*call, *error, conditions);
    }
    let protection = NoBitsBut(
        2,
        PROT_READ | PROT_WRITE | OF_ARM | if generates_code { PROT_EXEC } else { 0 },
    );
    it.limit(
        SYS_mmap,
        EPERM,
        &[
            protection,
            NoBitsBut(3, OF_MAPPINGS),
            NotAllOf(3, MAP_SHARED | MAP_ANONYMOUS),
            Above(4, 2),
        ],
    );
    for call in [SYS_mprotect, SYS_pkey_mprotect] {
        it.limit(call, EPERM, &[protection]);
    }
    for call in ON_DESCRIPTORS {
        it.limit(*call, EPERM, &[NOT_STANDARD]);
    }
    for call in [SYS_tgkill, SYS_kill] {
        it.limit(call, EPERM, &[Is(0, own)]);
    }
    it.always(FREE, ALLOW);
    it.always(UNKNOWN, SECCOMP_RET_ERRNO | ENOSYS as u32);
    it.end(SECCOMP_RET_ERRNO | EPERM as u32);
    it
}

fn limit(resource: c_int, most: u64) {
    let mut it = [0u64; 2];
    // SAFETY: the soft limit and the hard one.
    unsafe {
        if syscall(SYS_prlimit64, 0usize, resource, 0usize, &raw mut it) == 0 {
            it = it.map(|it| it.min(most));
            syscall(SYS_prlimit64, 0usize, resource, &raw const it, 0usize);
        }
    }
}

fn limit_resources() {
    const DATA: usize = 5;
    let pages = std::fs::read_to_string("/proc/self/statm")
        .ok()
        .and_then(|all| all.split(' ').nth(DATA)?.parse::<u64>().ok());
    if let Some(pages) = pages {
        // SAFETY: it only takes a number.
        limit(
            RLIMIT_DATA as _,
            pages * unsafe { sysconf(_SC_PAGESIZE) } as u64 + (16 << 30),
        );
    }
    limit(RLIMIT_CORE as _, 0);
    limit(RLIMIT_FSIZE as _, 1 << 36);
    limit(RLIMIT_NOFILE as _, 4096);
}

fn has_other_threads() -> bool {
    !std::fs::metadata("/proc/self/task").is_ok_and(|it| it.nlink() == 3)
}

fn give_up_directories() {
    for it in 4..256 {
        let mut about = std::mem::MaybeUninit::<stat>::uninit();
        // SAFETY: it is written to unless that fails. The number stays in use.
        unsafe {
            if fstat(it, about.as_mut_ptr()) == 0 && about.assume_init().st_mode & S_IFMT == S_IFDIR
            {
                dup3(0, it, O_CLOEXEC);
            }
        }
    }
}

/// Of this thread, and of those that it starts.
fn set_capabilities(kept: u32) {
    const VERSION_3: u32 = 0x2008_0522;
    // SAFETY: a header, and the two sets that this version has.
    unsafe { syscall(SYS_capset, &[VERSION_3, 0], &[kept, kept, 0, 0, 0, 0]) };
}

/// Not every system lets a user have them.
fn enter_namespaces() {
    const CAP_SYS_CHROOT: u32 = 18;
    // SAFETY: it only takes a number.
    if unsafe { unshare(CLONE_NEWUSER | CLONE_NEWNET | CLONE_NEWIPC) } == 0 {
        limit(RLIMIT_NPROC as _, 1024);
        set_capabilities(1 << CAP_SYS_CHROOT);
    }
}

/// With all threads, if it has a namespace.
fn leave_file_system() {
    // SAFETY: C strings.
    unsafe {
        if chroot(c"/proc/self/fdinfo".as_ptr()) == 0 {
            chdir(c"/".as_ptr());
        }
    }
    set_capabilities(0);
}

/// For this thread, and those that it starts. Not every kernel has it.
fn enter_landlock(may_read: bool) {
    const ASKS_FOR_VERSION: u32 = 1;
    const READ_FILE_AND_DIRECTORY: u64 = 0b1100;
    // SAFETY: the size is at most that of the array.
    unsafe {
        let version = syscall(
            SYS_landlock_create_ruleset,
            0usize,
            0usize,
            ASKS_FOR_VERSION,
        );
        let (rights_to_files, fields) = match version {
            ..=0 => return,
            1 => (13, 1),
            2 => (14, 1),
            3 => (15, 1),
            4 => (15, 2),
            5 => (16, 2),
            _ => (16, 3),
        };
        let handled = [
            ((1u64 << rights_to_files) - 1) & !if may_read { READ_FILE_AND_DIRECTORY } else { 0 },
            0b11,
            0b11,
        ];
        let size = fields * size_of::<u64>();
        let rules = syscall(SYS_landlock_create_ruleset, &handled, size, 0u32);
        if rules >= 0 {
            syscall(SYS_landlock_restrict_self, rules, 0u32);
            close(rules as c_int);
        }
    }
}

static IS_PREPARED: AtomicBool = AtomicBool::new(false);

pub fn prepare() {
    // SAFETY: it only takes numbers.
    if !has_other_threads()
        && unsafe { prctl(PR_SET_NO_NEW_PRIVS, 1usize, 0usize, 0usize, 0usize) } == 0
    {
        // It goes first when memory runs out.
        drop(std::fs::write("/proc/self/oom_score_adj", "300"));
        enter_namespaces();
        enter_landlock(true);
        IS_PREPARED.store(true, Ordering::Relaxed);
    }
}

pub fn enter(generates_code: bool) -> bool {
    if !IS_PREPARED.load(Ordering::Relaxed) {
        return false;
    }
    give_up_directories();
    limit_resources();
    leave_file_system();
    enter_landlock(false);
    let mut filter = filter(std::process::id(), generates_code);
    let program = sock_fprog {
        len: filter.0.len() as u16,
        filter: filter.0.as_mut_ptr(),
    };
    // SAFETY: the kernel copies the program.
    unsafe {
        syscall(
            SYS_seccomp,
            SECCOMP_SET_MODE_FILTER,
            SECCOMP_FILTER_FLAG_TSYNC,
            &program,
        ) == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The status of a process that exits with what `inside` returns.
    fn in_sandbox(generates_code: bool, inside: impl FnOnce() -> bool) -> c_int {
        let mut status = 0;
        // SAFETY: the child does not return.
        unsafe {
            let child = fork();
            if child == 0 {
                prepare();
                _exit(if enter(generates_code) {
                    (!inside()).into()
                } else {
                    2
                });
            }
            waitpid(child, &mut status, 0);
        }
        status
    }

    fn map(protection: c_int, flags: c_int) -> bool {
        // SAFETY: a new mapping.
        unsafe {
            mmap(
                std::ptr::null_mut(),
                4096,
                protection,
                flags | MAP_ANONYMOUS,
                -1,
                0,
            ) != MAP_FAILED
        }
    }

    #[test]
    fn refuses_what_leads_outside() {
        let (root, parent) = (c"/".as_ptr().addr(), std::process::id() as usize);
        let calls: &[(c_long, [usize; 4])] = &[
            (SYS_openat, [AT_FDCWD as usize, root, 0, 0]),
            (SYS_newfstatat, [AT_FDCWD as usize, root, 0, 0]),
            (SYS_mkdirat, [AT_FDCWD as usize, root, 0, 0]),
            (SYS_chdir, [root, 0, 0, 0]),
            (SYS_execve, [root, 0, 0, 0]),
            (SYS_socket, [AF_UNIX as usize, SOCK_STREAM as usize, 0, 0]),
            (SYS_socket, [AF_INET as usize, SOCK_DGRAM as usize, 0, 0]),
            (
                SYS_socketpair,
                [AF_UNIX as usize, SOCK_STREAM as usize, 0, 0],
            ),
            (SYS_sendmsg, [3, 0, 0, 0]),
            (SYS_clone, [SIGCHLD as usize, 0, 0, 0]),
            (SYS_kill, [parent, 0, 0, 0]),
            (SYS_kill, [0, 0, 0, 0]),
            (SYS_kill, [usize::MAX, 0, 0, 0]),
            (SYS_tgkill, [parent, parent, 0, 0]),
            (SYS_pidfd_open, [parent, 0, 0, 0]),
            (SYS_ptrace, [PTRACE_TRACEME as usize, 0, 0, 0]),
            (SYS_process_vm_readv, [parent, 0, 0, 0]),
            (SYS_prlimit64, [parent, 0, 0, 0]),
            (SYS_setpriority, [0, parent, 19, 0]),
            (SYS_memfd_create, [root, 0, 0, 0]),
            (SYS_io_uring_setup, [1, 0, 0, 0]),
            (SYS_userfaultfd, [0; 4]),
            (SYS_bpf, [0; 4]),
            (SYS_perf_event_open, [0; 4]),
            (SYS_keyctl, [0; 4]),
            (SYS_shmget, [0, 4096, 0o600, 0]),
            (SYS_unshare, [CLONE_NEWUSER as usize, 0, 0, 0]),
            (SYS_seccomp, [0; 4]),
            (SYS_fcntl, [3, F_SETOWN as usize, parent, 0]),
            (SYS_read, [0; 4]),
        ];
        for &(call, [a, b, c, d]) in calls {
            // SAFETY: the pointers are null or C strings.
            let is_refused = || unsafe {
                syscall(call, a, b, c, d, 0usize, 0usize) == -1 && *__errno_location() == EPERM
            };
            assert_eq!((call, a, in_sandbox(true, is_refused)), (call, a, 0));
        }
        // SAFETY: a byte.
        assert_eq!(
            in_sandbox(true, || unsafe {
                ioctl(0, TIOCSTI, c"a".as_ptr()) == -1 && *__errno_location() == ENOTTY
            }),
            0
        );
        assert_eq!(
            in_sandbox(true, || !map(PROT_READ | PROT_WRITE, MAP_SHARED)),
            0
        );
    }

    #[test]
    fn keeps_threads_memory_and_time() {
        let works = || {
            std::thread::sleep(std::time::Duration::from_micros(10));
            std::thread::spawn(|| vec![1u8; 64 << 20].len())
                .join()
                .is_ok_and(|it| it == 64 << 20)
        };
        assert_eq!(in_sandbox(false, works), 0);
    }

    #[test]
    fn executable_memory_is_for_compilers() {
        assert_eq!(
            [true, false].map(|it| in_sandbox(it, || map(PROT_READ | PROT_EXEC, MAP_PRIVATE))),
            [0, 1 << 8]
        );
    }

    fn holds_in_child(it: impl FnOnce() -> bool) -> bool {
        // SAFETY: the child does not return.
        unsafe {
            let (child, mut status) = (fork(), 0);
            if child == 0 {
                _exit((!it()).into());
            }
            waitpid(child, &mut status, 0);
            status == 0
        }
    }

    #[test]
    fn needs_to_be_alone_at_first() {
        assert!(holds_in_child(|| {
            std::thread::spawn(std::thread::park);
            prepare();
            !enter(true)
        }));
    }

    #[test]
    fn takes_along_threads_that_are_there() {
        assert!(holds_in_child(|| {
            prepare();
            let (go, wait) = std::sync::mpsc::channel();
            let other = std::thread::spawn(move || {
                wait.recv().is_ok()
                    && std::fs::read("/etc/passwd").is_err()
                    && std::net::UdpSocket::bind("127.0.0.1:0").is_err()
            });
            std::fs::read("/etc/passwd").is_ok()
                && enter(true)
                && go.send(()).is_ok()
                && other.join().unwrap()
        }));
    }

    #[test]
    #[cfg(target_arch = "x86_64")]
    fn other_conventions_are_fatal() {
        // SAFETY: getpid.
        let x32 = || unsafe { syscall(SYS_getpid | 0x4000_0000) != 0 };
        assert_eq!(WTERMSIG(in_sandbox(true, x32)), SIGSYS);
    }
}
