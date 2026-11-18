use std::ffi::{CString, c_char, c_int};

/// The default does not cover what the system has learned to deny later.
const PROFILE: &str = r#"(version 1)
(deny default (with no-log))
(deny file-map-executable iokit-get-properties nvram* process-info* (with no-log))
(allow process-info-pidinfo process-info-rusage process-info-setcontrol signal (target self))
(allow sysctl-read (sysctl-name-prefix "hw.") (sysctl-name "kern.osproductversion" "kern.osrelease" "kern.ostype" "kern.osvariant_status" "kern.osversion" "kern.usrstack64" "kern.version" "machdep.cpu.brand_string"))
(allow file-read* (subpath "/usr/share/icu") (subpath "/private/var/db/timezone"))
(allow file-read-metadata (literal "/var"))
"#;

pub fn prepare() {}

pub fn enter(generates_code: bool) -> bool {
    unsafe extern "C" {
        fn sandbox_init(profile: *const c_char, flags: u64, error: *mut *mut c_char) -> c_int;
    }
    let more = if generates_code {
        ""
    } else {
        "(deny dynamic-code-generation)"
    };
    let (profile, mut error) = (
        CString::new([PROFILE, more].concat()).expect("it is text"),
        std::ptr::null_mut(),
    );
    for (resource, most) in [
        (libc::RLIMIT_CORE, 0),
        (libc::RLIMIT_FSIZE, 1 << 36),
        (libc::RLIMIT_NOFILE, 4096),
    ] {
        let mut limit = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        // SAFETY: it is written to, and then read.
        unsafe {
            if libc::getrlimit(resource, &mut limit) == 0 {
                libc::setrlimit(
                    resource,
                    &libc::rlimit {
                        rlim_cur: limit.rlim_cur.min(most),
                        rlim_max: limit.rlim_max.min(most),
                    },
                );
            }
        }
    }
    // SAFETY: a C string.
    unsafe { sandbox_init(profile.as_ptr(), 0, &raw mut error) == 0 }
}

#[cfg(test)]
mod tests {
    use std::io::{Read as _, Write as _};
    use std::os::fd::AsRawFd as _;
    use std::os::unix::net::{UnixDatagram, UnixStream};
    use std::process::Command;

    use libc::*;

    use super::super::super::ring::Shared;
    use super::enter;

    unsafe extern "C" {
        static bootstrap_port: u32;
        fn bootstrap_look_up(bootstrap: u32, name: *const c_char, port: *mut u32) -> c_int;
        fn task_for_pid(task: u32, pid: c_int, port: *mut u32) -> c_int;
        fn task_info(task: u32, flavor: u32, info: *mut c_int, count: *mut u32) -> c_int;
        fn semaphore_create(task: u32, semaphore: *mut u32, policy: c_int, value: c_int) -> c_int;
        fn ucal_open(
            zone: *const u16,
            length: i32,
            locale: *const c_char,
            kind: c_int,
            status: *mut c_int,
        ) -> *mut c_void;
        fn ubrk_open(
            kind: c_int,
            locale: *const c_char,
            text: *const u16,
            length: i32,
            status: *mut c_int,
        ) -> *mut c_void;
        static mach_task_self_: u32;
    }

    #[link(name = "icucore")]
    unsafe extern "C" {}

    fn map(protection: c_int, flags: c_int) -> bool {
        // SAFETY: a new mapping.
        unsafe {
            mmap(
                std::ptr::null_mut(),
                1 << 14,
                protection,
                flags | MAP_ANON | MAP_PRIVATE,
                -1,
                0,
            ) != MAP_FAILED
        }
    }

    fn reads(name: &std::ffi::CStr) -> bool {
        let mut length = 0;
        // SAFETY: it only tells the length.
        unsafe {
            sysctlbyname(
                name.as_ptr(),
                std::ptr::null_mut(),
                &mut length,
                std::ptr::null_mut(),
                0,
            ) == 0
        }
    }

    /// The names of what works.
    #[test]
    fn inside() {
        let Ok(mode) = std::env::var("SANDBOX") else {
            return;
        };
        let (program, (_, memory), (mut near, mut far)) = (
            std::env::current_exe().unwrap(),
            Shared::create().unwrap(),
            UnixStream::pair().unwrap(),
        );
        let opened = std::fs::File::open(&program).unwrap();
        assert!(mode == "none" || enter(mode == "compiler"));
        let (mut port, mut status, zone) =
            (0, 0, "Europe/Berlin".encode_utf16().collect::<Vec<_>>());
        let look_up = |name: &std::ffi::CStr| {
            let mut port = 0;
            // SAFETY: a C string, and it is written to.
            unsafe { bootstrap_look_up(bootstrap_port, name.as_ptr(), &mut port) == 0 }
        };
        // SAFETY: C strings, and what is written to has room.
        let all = unsafe {
            [
                (
                    "thread",
                    std::thread::spawn(|| vec![1u8; 64 << 20].len())
                        .join()
                        .is_ok(),
                ),
                ("ring", Shared::map(&memory).is_some()),
                (
                    "pair",
                    near.write_all(&[1])
                        .and_then(|()| far.read_exact(&mut [0]))
                        .is_ok(),
                ),
                (
                    "fstat",
                    fstat(memory.as_raw_fd(), &mut std::mem::zeroed()) == 0,
                ),
                ("kqueue", kqueue() >= 0),
                ("pipe", pipe([0; 2].as_mut_ptr()) == 0),
                ("random", getentropy([0u8; 8].as_mut_ptr().cast(), 8) == 0),
                (
                    "semaphore",
                    semaphore_create(mach_task_self_, &mut port, 0, 0) == 0,
                ),
                (
                    "footprint",
                    task_info(mach_task_self_, 22, [0; 128].as_mut_ptr(), &mut 128) == 0,
                ),
                (
                    "hardware",
                    reads(c"hw.ncpu") && reads(c"hw.memsize") && reads(c"hw.optional.arm64"),
                ),
                (
                    "zone",
                    !ucal_open(
                        zone.as_ptr(),
                        zone.len() as _,
                        c"en".as_ptr(),
                        1,
                        &mut status,
                    )
                    .is_null()
                        && status <= 0,
                ),
                (
                    "words",
                    !ubrk_open(1, c"th".as_ptr(), std::ptr::null(), 0, &mut status).is_null()
                        && status <= 0,
                ),
                ("jit", map(PROT_READ | PROT_WRITE | PROT_EXEC, MAP_JIT)),
                ("read", std::fs::read("/etc/hosts").is_ok()),
                ("stat", std::fs::metadata(&program).is_ok()),
                ("list", std::fs::read_dir("/").is_ok()),
                (
                    "write",
                    std::fs::write(std::env::temp_dir().join("sandbox-test"), "").is_ok(),
                ),
                ("listen", std::net::TcpListener::bind("127.0.0.1:0").is_ok()),
                ("datagram", std::net::UdpSocket::bind("127.0.0.1:0").is_ok()),
                (
                    "log",
                    UnixDatagram::unbound()
                        .and_then(|it| it.connect("/var/run/syslog"))
                        .is_ok(),
                ),
                ("spawn", Command::new("/usr/bin/true").status().is_ok()),
                ("signal", kill(getppid(), 0) == 0),
                (
                    "arguments",
                    sysctl(
                        [CTL_KERN, KERN_PROCARGS2, getppid()].as_mut_ptr(),
                        3,
                        std::ptr::null_mut(),
                        &mut 0,
                        std::ptr::null_mut(),
                        0,
                    ) == 0,
                ),
                (
                    "task",
                    task_for_pid(mach_task_self_, getppid(), &mut port) == 0,
                ),
                ("serial", reads(c"kern.uuid")),
                (
                    "shm",
                    shm_open(c"/sandbox-test".as_ptr(), O_RDWR | O_CREAT, 0o600) >= 0
                        && shm_unlink(c"/sandbox-test".as_ptr()) == 0,
                ),
                (
                    "launchservices",
                    look_up(c"com.apple.coreservices.launchservicesd"),
                ),
                ("preferences", look_up(c"com.apple.cfprefsd.daemon")),
                ("keychain", look_up(c"com.apple.SecurityServer")),
                ("windows", look_up(c"com.apple.windowserver.active")),
                (
                    "executable",
                    mmap(
                        std::ptr::null_mut(),
                        1 << 14,
                        PROT_READ | PROT_EXEC,
                        MAP_PRIVATE,
                        opened.as_raw_fd(),
                        0,
                    ) != MAP_FAILED,
                ),
            ]
        };
        println!(
            "works: {}",
            all.iter()
                .filter(|it| it.1)
                .map(|it| it.0)
                .collect::<Vec<_>>()
                .join(" ")
        );
    }

    fn works_in(mode: &str) -> String {
        let name = concat!(module_path!(), "::inside")
            .split_once("::")
            .unwrap()
            .1;
        let output = Command::new(std::env::current_exe().unwrap())
            .args([name, "--exact", "--nocapture"])
            .env("SANDBOX", mode)
            .output()
            .unwrap();
        let output = String::from_utf8_lossy(&output.stdout);
        output
            .lines()
            .find_map(|it| Some(it.split_once("works: ")?.1))
            .unwrap_or(&output)
            .into()
    }

    const NEEDED: &str =
        "thread ring pair fstat kqueue pipe random semaphore footprint hardware zone words";

    #[test]
    fn leaves_what_is_needed_and_nothing_else() {
        assert_eq!(works_in("program"), NEEDED);
        assert_eq!(works_in("compiler"), format!("{NEEDED} jit"));
        let all = works_in("none");
        assert!(
            all.starts_with(&format!(
                "{NEEDED} jit read stat list write listen datagram log spawn signal arguments"
            )) && all.ends_with("executable"),
            "{all}"
        );
    }
}
