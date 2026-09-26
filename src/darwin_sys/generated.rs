// Written by misctools/portable/bindings/darwin.ts. Do not edit.
//
// Definitions of macOS for the portable image, from the `libc` crate 0.2.186 as rustdoc documents it
// for x86_64-apple-darwin and aarch64-apple-darwin. The files of the crate they are in:
//   src/unix/bsd/apple/mod.rs
//   src/unix/bsd/mod.rs
//   src/unix/mod.rs
// misctools/portable/bindings/darwin.json names the file of each one.
#![allow(deprecated)]

/// Types. An integer type of C is written as the integer it is on macOS.
pub mod types {
    use core::ffi::c_void;

    pub type attrgroup_t = u32;
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct attrlist {
        pub bitmapcount: u16,
        pub reserved: u16,
        pub commonattr: u32,
        pub volattr: u32,
        pub dirattr: u32,
        pub fileattr: u32,
        pub forkattr: u32,
    }
    pub type blkcnt_t = i64;
    pub type blksize_t = i32;
    pub type copyfile_flags_t = u32;
    pub type copyfile_state_t = *mut c_void;
    pub type dev_t = i32;
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct dirent {
        pub d_ino: u64,
        pub d_seekoff: u64,
        pub d_reclen: u16,
        pub d_namlen: u16,
        pub d_type: u8,
        pub d_name: [i8; 1024],
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct flock {
        pub l_start: i64,
        pub l_len: i64,
        pub l_pid: i32,
        pub l_type: i16,
        pub l_whence: i16,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct fsid_t {
        __fsid_val: [i32; 2],
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct fstore_t {
        pub fst_flags: u32,
        pub fst_posmode: i32,
        pub fst_offset: i64,
        pub fst_length: i64,
        pub fst_bytesalloc: i64,
    }
    pub type gid_t = u32;
    pub type host_flavor_t = i32;
    pub type host_info64_t = *mut i32;
    pub type host_t = u32;
    pub type ino_t = u64;
    pub type integer_t = i32;
    pub type intptr_t = isize;
    pub use ::libc::iovec;
    pub type kern_return_t = i32;
    #[repr(C, packed(4))]
    #[derive(Clone, Copy)]
    pub struct kevent {
        pub ident: usize,
        pub filter: i16,
        pub flags: u16,
        pub fflags: u32,
        pub data: isize,
        pub udata: *mut c_void,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct kevent64_s {
        pub ident: u64,
        pub filter: i16,
        pub flags: u16,
        pub fflags: u32,
        pub data: i64,
        pub udata: u64,
        pub ext: [u64; 2],
    }
    pub type mach_msg_type_number_t = u32;
    pub type mach_port_t = u32;
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct mach_timebase_info {
        pub numer: u32,
        pub denom: u32,
    }
    pub type mach_timebase_info_data_t = mach_timebase_info;
    pub type mode_t = u16;
    pub type natural_t = u32;
    pub type nfds_t = u32;
    pub type nl_item = i32;
    pub type nlink_t = u16;
    pub type off_t = i64;
    pub type os_unfair_lock = os_unfair_lock_s;
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct os_unfair_lock_s {
        _os_unfair_lock_opaque: u32,
    }
    pub type os_unfair_lock_t = *mut os_unfair_lock_s;
    pub type pid_t = i32;
    pub use ::libc::pollfd;
    pub type posix_spawn_file_actions_t = *mut c_void;
    pub type posix_spawnattr_t = *mut c_void;
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct processor_cpu_load_info {
        pub cpu_ticks: [u32; 4],
    }
    pub type processor_cpu_load_info_data_t = processor_cpu_load_info;
    pub type processor_flavor_t = i32;
    pub type processor_info_array_t = *mut i32;
    pub type pthread_t = usize;
    pub type sa_family_t = u8;
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct sf_hdtr {
        pub headers: *mut iovec,
        pub hdr_cnt: i32,
        pub trailers: *mut iovec,
        pub trl_cnt: i32,
    }
    pub type sigset_t = u32;
    pub type size_t = usize;
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct sockaddr {
        pub sa_len: u8,
        pub sa_family: u8,
        pub sa_data: [i8; 14],
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct sockaddr_dl {
        pub sdl_len: u8,
        pub sdl_family: u8,
        pub sdl_index: u16,
        pub sdl_type: u8,
        pub sdl_nlen: u8,
        pub sdl_alen: u8,
        pub sdl_slen: u8,
        pub sdl_data: [i8; 12],
    }
    pub type socklen_t = u32;
    pub type speed_t = u64;
    pub type ssize_t = isize;
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct stat {
        pub st_dev: i32,
        pub st_mode: u16,
        pub st_nlink: u16,
        pub st_ino: u64,
        pub st_uid: u32,
        pub st_gid: u32,
        pub st_rdev: i32,
        pub st_atime: i64,
        pub st_atime_nsec: i64,
        pub st_mtime: i64,
        pub st_mtime_nsec: i64,
        pub st_ctime: i64,
        pub st_ctime_nsec: i64,
        pub st_birthtime: i64,
        pub st_birthtime_nsec: i64,
        pub st_size: i64,
        pub st_blocks: i64,
        pub st_blksize: i32,
        pub st_flags: u32,
        pub st_gen: u32,
        pub st_lspare: i32,
        pub st_qspare: [i64; 2],
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct statfs {
        pub f_bsize: u32,
        pub f_iosize: i32,
        pub f_blocks: u64,
        pub f_bfree: u64,
        pub f_bavail: u64,
        pub f_files: u64,
        pub f_ffree: u64,
        pub f_fsid: fsid_t,
        pub f_owner: u32,
        pub f_type: u32,
        pub f_flags: u32,
        pub f_fssubtype: u32,
        pub f_fstypename: [i8; 16],
        pub f_mntonname: [i8; 1024],
        pub f_mntfromname: [i8; 1024],
        pub f_flags_ext: u32,
        pub f_reserved: [u32; 7],
    }
    pub type suseconds_t = i32;
    pub type tcflag_t = u64;
    pub type time_t = i64;
    pub use ::libc::timespec;
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct timeval {
        pub tv_sec: i64,
        pub tv_usec: i32,
    }
    pub type uid_t = u32;
    pub type uintptr_t = usize;
    pub type vm_address_t = usize;
    pub type vm_map_t = u32;
    pub type vm_offset_t = usize;
    pub type vm_size_t = usize;
    #[repr(C, packed(8))]
    #[derive(Clone, Copy)]
    pub struct vm_statistics64 {
        pub free_count: u32,
        pub active_count: u32,
        pub inactive_count: u32,
        pub wire_count: u32,
        pub zero_fill_count: u64,
        pub reactivations: u64,
        pub pageins: u64,
        pub pageouts: u64,
        pub faults: u64,
        pub cow_faults: u64,
        pub lookups: u64,
        pub hits: u64,
        pub purges: u64,
        pub purgeable_count: u32,
        pub speculative_count: u32,
        pub decompressions: u64,
        pub compressions: u64,
        pub swapins: u64,
        pub swapouts: u64,
        pub compressor_page_count: u32,
        pub throttled_count: u32,
        pub external_page_count: u32,
        pub internal_page_count: u32,
        pub total_uncompressed_pages_in_compressor: u64,
    }
    pub type vm_statistics64_data_t = vm_statistics64;
}

/// Constants, with the values of macOS.
pub mod constants {

    pub const AT_EACCESS: i32 = 16;
    pub const AT_FDCWD: i32 = -2;
    pub const AT_REMOVEDIR: i32 = 128;
    pub const AT_SYMLINK_FOLLOW: i32 = 64;
    pub const AT_SYMLINK_NOFOLLOW: i32 = 32;
    pub const COPYFILE_ACL: u32 = 1;
    pub const COPYFILE_CHECK: u32 = 65536;
    pub const COPYFILE_CLONE: u32 = 16777216;
    pub const COPYFILE_CLONE_FORCE: u32 = 33554432;
    pub const COPYFILE_CONTINUE: i32 = 0;
    pub const COPYFILE_COPY_DATA: i32 = 4;
    pub const COPYFILE_COPY_XATTR: i32 = 5;
    pub const COPYFILE_DATA: u32 = 8;
    pub const COPYFILE_DATA_SPARSE: u32 = 134217728;
    pub const COPYFILE_ERR: i32 = 3;
    pub const COPYFILE_EXCL: u32 = 131072;
    pub const COPYFILE_FINISH: i32 = 2;
    pub const COPYFILE_METADATA: u32 = 7;
    pub const COPYFILE_MOVE: u32 = 1048576;
    pub const COPYFILE_NOFOLLOW: u32 = 786432;
    pub const COPYFILE_NOFOLLOW_DST: u32 = 524288;
    pub const COPYFILE_NOFOLLOW_SRC: u32 = 262144;
    pub const COPYFILE_PACK: u32 = 4194304;
    pub const COPYFILE_PRESERVE_DST_TRACKED: u32 = 268435456;
    pub const COPYFILE_PROGRESS: i32 = 4;
    pub const COPYFILE_QUIT: i32 = 2;
    pub const COPYFILE_RECURSE_DIR: i32 = 2;
    pub const COPYFILE_RECURSE_DIR_CLEANUP: i32 = 3;
    pub const COPYFILE_RECURSE_ERROR: i32 = 0;
    pub const COPYFILE_RECURSE_FILE: i32 = 1;
    pub const COPYFILE_RECURSIVE: u32 = 32768;
    pub const COPYFILE_RUN_IN_PLACE: u32 = 67108864;
    pub const COPYFILE_SECURITY: u32 = 3;
    pub const COPYFILE_SKIP: i32 = 1;
    pub const COPYFILE_START: i32 = 1;
    pub const COPYFILE_STAT: u32 = 2;
    pub const COPYFILE_STATE_BSIZE: i32 = 13;
    pub const COPYFILE_STATE_COPIED: i32 = 8;
    pub const COPYFILE_STATE_DST_BSIZE: i32 = 12;
    pub const COPYFILE_STATE_DST_FD: i32 = 3;
    pub const COPYFILE_STATE_DST_FILENAME: i32 = 4;
    pub const COPYFILE_STATE_QUARANTINE: i32 = 5;
    pub const COPYFILE_STATE_SRC_BSIZE: i32 = 11;
    pub const COPYFILE_STATE_SRC_FD: i32 = 1;
    pub const COPYFILE_STATE_SRC_FILENAME: i32 = 2;
    pub const COPYFILE_STATE_STATUS_CB: i32 = 6;
    pub const COPYFILE_STATE_STATUS_CTX: i32 = 7;
    pub const COPYFILE_STATE_WAS_CLONED: i32 = 10;
    pub const COPYFILE_STATE_XATTRNAME: i32 = 9;
    pub const COPYFILE_UNLINK: u32 = 2097152;
    pub const COPYFILE_UNPACK: u32 = 8388608;
    pub const COPYFILE_VERBOSE: u32 = 1073741824;
    pub const COPYFILE_XATTR: u32 = 4;
    pub const CPU_STATE_IDLE: i32 = 2;
    pub const CPU_STATE_MAX: i32 = 4;
    pub const CPU_STATE_NICE: i32 = 3;
    pub const CPU_STATE_SYSTEM: i32 = 1;
    pub const CPU_STATE_USER: i32 = 0;
    pub const DT_BLK: u8 = 6;
    pub const DT_CHR: u8 = 2;
    pub const DT_DIR: u8 = 4;
    pub const DT_FIFO: u8 = 1;
    pub const DT_LNK: u8 = 10;
    pub const DT_REG: u8 = 8;
    pub const DT_SOCK: u8 = 12;
    pub const DT_UNKNOWN: u8 = 0;
    pub const E2BIG: i32 = 7;
    pub const EACCES: i32 = 13;
    pub const EADDRINUSE: i32 = 48;
    pub const EADDRNOTAVAIL: i32 = 49;
    pub const EAFNOSUPPORT: i32 = 47;
    pub const EAGAIN: i32 = 35;
    pub const EALREADY: i32 = 37;
    pub const EAUTH: i32 = 80;
    pub const EBADARCH: i32 = 86;
    pub const EBADEXEC: i32 = 85;
    pub const EBADF: i32 = 9;
    pub const EBADMACHO: i32 = 88;
    pub const EBADMSG: i32 = 94;
    pub const EBADRPC: i32 = 72;
    pub const EBUSY: i32 = 16;
    pub const ECANCELED: i32 = 89;
    pub const ECHILD: i32 = 10;
    pub const ECHO: u64 = 8;
    pub const ECHOCTL: u64 = 64;
    pub const ECHOE: u64 = 2;
    pub const ECHOK: u64 = 4;
    pub const ECHOKE: u64 = 1;
    pub const ECHONL: u64 = 16;
    pub const ECHOPRT: u64 = 32;
    pub const ECONNABORTED: i32 = 53;
    pub const ECONNREFUSED: i32 = 61;
    pub const ECONNRESET: i32 = 54;
    pub const EDEADLK: i32 = 11;
    pub const EDESTADDRREQ: i32 = 39;
    pub const EDEVERR: i32 = 83;
    pub const EDOM: i32 = 33;
    pub const EDQUOT: i32 = 69;
    pub const EEXIST: i32 = 17;
    pub const EFAULT: i32 = 14;
    pub const EFBIG: i32 = 27;
    pub const EFTYPE: i32 = 79;
    pub const EHOSTDOWN: i32 = 64;
    pub const EHOSTUNREACH: i32 = 65;
    pub const EIDRM: i32 = 90;
    pub const EILSEQ: i32 = 92;
    pub const EINPROGRESS: i32 = 36;
    pub const EINTR: i32 = 4;
    pub const EINVAL: i32 = 22;
    pub const EIO: i32 = 5;
    pub const EISCONN: i32 = 56;
    pub const EISDIR: i32 = 21;
    pub const ELAST: i32 = 106;
    pub const ELOOP: i32 = 62;
    pub const EMFILE: i32 = 24;
    pub const EMLINK: i32 = 31;
    pub const EMPTY: i16 = 0;
    pub const EMSGSIZE: i32 = 40;
    pub const EMULTIHOP: i32 = 95;
    pub const ENAMETOOLONG: i32 = 63;
    pub const ENEEDAUTH: i32 = 81;
    pub const ENETDOWN: i32 = 50;
    pub const ENETRESET: i32 = 52;
    pub const ENETUNREACH: i32 = 51;
    pub const ENFILE: i32 = 23;
    pub const ENOATTR: i32 = 93;
    pub const ENOBUFS: i32 = 55;
    pub const ENODATA: i32 = 96;
    pub const ENODEV: i32 = 19;
    pub const ENOENT: i32 = 2;
    pub const ENOEXEC: i32 = 8;
    pub const ENOLCK: i32 = 77;
    pub const ENOLINK: i32 = 97;
    pub const ENOMEM: i32 = 12;
    pub const ENOMSG: i32 = 91;
    pub const ENOPOLICY: i32 = 103;
    pub const ENOPROTOOPT: i32 = 42;
    pub const ENOSPC: i32 = 28;
    pub const ENOSR: i32 = 98;
    pub const ENOSTR: i32 = 99;
    pub const ENOSYS: i32 = 78;
    pub const ENOTBLK: i32 = 15;
    pub const ENOTCONN: i32 = 57;
    pub const ENOTDIR: i32 = 20;
    pub const ENOTEMPTY: i32 = 66;
    pub const ENOTRECOVERABLE: i32 = 104;
    pub const ENOTSOCK: i32 = 38;
    pub const ENOTSUP: i32 = 45;
    pub const ENOTTY: i32 = 25;
    pub const ENXIO: i32 = 6;
    pub const EOF: i32 = -1;
    pub const EOPNOTSUPP: i32 = 102;
    pub const EOVERFLOW: i32 = 84;
    pub const EOWNERDEAD: i32 = 105;
    pub const EPERM: i32 = 1;
    pub const EPFNOSUPPORT: i32 = 46;
    pub const EPIPE: i32 = 32;
    pub const EPROCLIM: i32 = 67;
    pub const EPROCUNAVAIL: i32 = 76;
    pub const EPROGMISMATCH: i32 = 75;
    pub const EPROGUNAVAIL: i32 = 74;
    pub const EPROTO: i32 = 100;
    pub const EPROTONOSUPPORT: i32 = 43;
    pub const EPROTOTYPE: i32 = 41;
    pub const EPWROFF: i32 = 82;
    pub const EQFULL: i32 = 106;
    pub const ERA: i32 = 45;
    pub const ERANGE: i32 = 34;
    pub const EREMOTE: i32 = 71;
    pub const EROFS: i32 = 30;
    pub const ERPCMISMATCH: i32 = 73;
    pub const ESHLIBVERS: i32 = 87;
    pub const ESHUTDOWN: i32 = 58;
    pub const ESOCKTNOSUPPORT: i32 = 44;
    pub const ESPIPE: i32 = 29;
    pub const ESRCH: i32 = 3;
    pub const ESTALE: i32 = 70;
    pub const ETIME: i32 = 101;
    pub const ETIMEDOUT: i32 = 60;
    pub const ETOOMANYREFS: i32 = 59;
    pub const ETXTBSY: i32 = 26;
    pub const EUSERS: i32 = 68;
    pub const EV_ADD: u16 = 1;
    pub const EV_CLEAR: u16 = 32;
    pub const EV_DELETE: u16 = 2;
    pub const EV_DISABLE: u16 = 8;
    pub const EV_DISPATCH: u16 = 128;
    pub const EV_ENABLE: u16 = 4;
    pub const EV_EOF: u16 = 32768;
    pub const EV_ERROR: u16 = 16384;
    pub const EV_ONESHOT: u16 = 16;
    pub const EV_RECEIPT: u16 = 64;
    pub const EVFILT_MACHPORT: i16 = -8;
    pub const EVFILT_PROC: i16 = -5;
    pub const EVFILT_READ: i16 = -1;
    pub const EVFILT_SIGNAL: i16 = -6;
    pub const EVFILT_TIMER: i16 = -7;
    pub const EVFILT_USER: i16 = -10;
    pub const EVFILT_VNODE: i16 = -4;
    pub const EVFILT_WRITE: i16 = -2;
    pub const EWOULDBLOCK: i32 = 35;
    pub const EXDEV: i32 = 18;
    pub const EXTA: u64 = 19200;
    pub const EXTB: u64 = 38400;
    pub const EXTPROC: u64 = 2048;
    pub const F_ALLOCATEALL: u32 = 4;
    pub const F_ALLOCATECONTIG: u32 = 2;
    pub const F_BARRIERFSYNC: i32 = 85;
    pub const F_DUPFD: i32 = 0;
    pub const F_DUPFD_CLOEXEC: i32 = 67;
    pub const F_FULLFSYNC: i32 = 51;
    pub const F_GETFD: i32 = 1;
    pub const F_GETFL: i32 = 3;
    pub const F_GETLK: i32 = 7;
    pub const F_GETPATH: i32 = 50;
    pub const F_GETPATH_NOFIRMLINK: i32 = 102;
    pub const F_NOCACHE: i32 = 48;
    pub const F_OK: i32 = 0;
    pub const F_PEOFPOSMODE: i32 = 3;
    pub const F_PREALLOCATE: i32 = 42;
    pub const F_RDADVISE: i32 = 44;
    pub const F_RDAHEAD: i32 = 45;
    pub const F_RDLCK: i16 = 1;
    pub const F_SETFD: i32 = 2;
    pub const F_SETFL: i32 = 4;
    pub const F_SETLK: i32 = 8;
    pub const F_SETLKW: i32 = 9;
    pub const F_UNLCK: i16 = 2;
    pub const F_VOLPOSMODE: i32 = 4;
    pub const F_WRLCK: i16 = 3;
    pub const FD_CLOEXEC: i32 = 1;
    pub const HOST_VM_INFO64: i32 = 4;
    pub const HOST_VM_INFO64_COUNT: u32 = 38;
    pub const MAXPATHLEN: i32 = 1024;
    pub const MSG_CTRUNC: i32 = 32;
    pub const MSG_DONTROUTE: i32 = 4;
    pub const MSG_DONTWAIT: i32 = 128;
    pub const MSG_EOF: i32 = 256;
    pub const MSG_EOR: i32 = 8;
    pub const MSG_FLUSH: i32 = 1024;
    pub const MSG_HAVEMORE: i32 = 8192;
    pub const MSG_HOLD: i32 = 2048;
    pub const MSG_NEEDSA: i32 = 65536;
    pub const MSG_NOSIGNAL: i32 = 524288;
    pub const MSG_OOB: i32 = 1;
    pub const MSG_PEEK: i32 = 2;
    pub const MSG_RCVMORE: i32 = 16384;
    pub const MSG_SEND: i32 = 4096;
    pub const MSG_TRUNC: i32 = 16;
    pub const MSG_WAITALL: i32 = 64;
    pub const NOTE_ATTRIB: u32 = 8;
    pub const NOTE_DELETE: u32 = 1;
    pub const NOTE_EXEC: u32 = 536870912;
    pub const NOTE_EXIT: u32 = 2147483648;
    pub const NOTE_EXITSTATUS: u32 = 67108864;
    pub const NOTE_EXTEND: u32 = 4;
    pub const NOTE_FORK: u32 = 1073741824;
    pub const NOTE_LINK: u32 = 16;
    pub const NOTE_RENAME: u32 = 32;
    pub const NOTE_REVOKE: u32 = 64;
    pub const NOTE_SIGNAL: u32 = 134217728;
    pub const NOTE_TRIGGER: u32 = 16777216;
    pub const NOTE_WRITE: u32 = 2;
    pub const O_ACCMODE: i32 = 3;
    pub const O_APPEND: i32 = 8;
    pub const O_ASYNC: i32 = 64;
    pub const O_CLOEXEC: i32 = 16777216;
    pub const O_CREAT: i32 = 512;
    pub const O_DIRECTORY: i32 = 1048576;
    pub const O_DSYNC: i32 = 4194304;
    pub const O_EVTONLY: i32 = 32768;
    pub const O_EXCL: i32 = 2048;
    pub const O_EXEC: i32 = 1073741824;
    pub const O_EXLOCK: i32 = 32;
    pub const O_FSYNC: i32 = 128;
    pub const O_NDELAY: i32 = 4;
    pub const O_NOCTTY: i32 = 131072;
    pub const O_NOFOLLOW: i32 = 256;
    pub const O_NOFOLLOW_ANY: i32 = 536870912;
    pub const O_NONBLOCK: i32 = 4;
    pub const O_RDONLY: i32 = 0;
    pub const O_RDWR: i32 = 2;
    pub const O_SEARCH: i32 = 1074790400;
    pub const O_SHLOCK: i32 = 16;
    pub const O_SYMLINK: i32 = 2097152;
    pub const O_SYNC: i32 = 128;
    pub const O_TRUNC: i32 = 1024;
    pub const O_WRONLY: i32 = 1;
    pub const PATH_MAX: i32 = 1024;
    pub const POLLERR: i16 = 8;
    pub const POLLHUP: i16 = 16;
    pub const POLLIN: i16 = 1;
    pub const POLLNVAL: i16 = 32;
    pub const POLLOUT: i16 = 4;
    pub const POLLPRI: i16 = 2;
    pub const POLLRDBAND: i16 = 128;
    pub const POLLRDNORM: i16 = 64;
    pub const POLLWRBAND: i16 = 256;
    pub const POLLWRNORM: i16 = 4;
    pub const PROCESSOR_CPU_LOAD_INFO: i32 = 2;
    pub const R_OK: i32 = 4;
    pub const RENAME_EXCL: u32 = 4;
    pub const RENAME_SWAP: u32 = 2;
    pub const S_IEXEC: u16 = 64;
    pub const S_IFBLK: u16 = 24576;
    pub const S_IFCHR: u16 = 8192;
    pub const S_IFDIR: u16 = 16384;
    pub const S_IFIFO: u16 = 4096;
    pub const S_IFLNK: u16 = 40960;
    pub const S_IFMT: u16 = 61440;
    pub const S_IFREG: u16 = 32768;
    pub const S_IFSOCK: u16 = 49152;
    pub const S_IREAD: u16 = 256;
    pub const S_IRGRP: u16 = 32;
    pub const S_IROTH: u16 = 4;
    pub const S_IRUSR: u16 = 256;
    pub const S_IRWXG: u16 = 56;
    pub const S_IRWXO: u16 = 7;
    pub const S_IRWXU: u16 = 448;
    pub const S_ISGID: u16 = 1024;
    pub const S_ISUID: u16 = 2048;
    pub const S_ISVTX: u16 = 512;
    pub const S_IWGRP: u16 = 16;
    pub const S_IWOTH: u16 = 2;
    pub const S_IWRITE: u16 = 128;
    pub const S_IWUSR: u16 = 128;
    pub const S_IXGRP: u16 = 8;
    pub const S_IXOTH: u16 = 1;
    pub const S_IXUSR: u16 = 64;
    pub const SEEK_CUR: i32 = 1;
    pub const SEEK_DATA: i32 = 4;
    pub const SEEK_END: i32 = 2;
    pub const SEEK_HOLE: i32 = 3;
    pub const SEEK_SET: i32 = 0;
    pub const SIGABRT: i32 = 6;
    pub const SIGALRM: i32 = 14;
    pub const SIGBUS: i32 = 10;
    pub const SIGCHLD: i32 = 20;
    pub const SIGCONT: i32 = 19;
    pub const SIGEMT: i32 = 7;
    pub const SIGFPE: i32 = 8;
    pub const SIGHUP: i32 = 1;
    pub const SIGILL: i32 = 4;
    pub const SIGINFO: i32 = 29;
    pub const SIGINT: i32 = 2;
    pub const SIGIO: i32 = 23;
    pub const SIGIOT: i32 = 6;
    pub const SIGKILL: i32 = 9;
    pub const SIGNATURE: i16 = 10;
    pub const SIGPIPE: i32 = 13;
    pub const SIGPROF: i32 = 27;
    pub const SIGQUIT: i32 = 3;
    pub const SIGSEGV: i32 = 11;
    pub const SIGSTKSZ: usize = 131072;
    pub const SIGSTOP: i32 = 17;
    pub const SIGSYS: i32 = 12;
    pub const SIGTERM: i32 = 15;
    pub const SIGTRAP: i32 = 5;
    pub const SIGTSTP: i32 = 18;
    pub const SIGTTIN: i32 = 21;
    pub const SIGTTOU: i32 = 22;
    pub const SIGURG: i32 = 16;
    pub const SIGUSR1: i32 = 30;
    pub const SIGUSR2: i32 = 31;
    pub const SIGVTALRM: i32 = 26;
    pub const SIGWINCH: i32 = 28;
    pub const SIGXCPU: i32 = 24;
    pub const SIGXFSZ: i32 = 25;
    pub const SO_NOSIGPIPE: i32 = 4130;
    pub const SO_RCVBUF: i32 = 4098;
    pub const SO_SNDBUF: i32 = 4097;
    pub const SOL_SOCKET: i32 = 65535;
    pub const W_OK: i32 = 2;
    pub const WNOHANG: i32 = 1;
    pub const WUNTRACED: i32 = 2;
    pub const X_OK: i32 = 1;
}

/// The functions, bound through the import table.
pub mod functions {
    use super::types::*;
    use core::ffi::c_void;

    #[bun_portable_macros::imports(library = "libSystem", host = "macos")]
    unsafe extern "C" {
        #[cfg_attr(bun_portable, no_errno)]
        pub fn __error() -> *mut i32;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn _NSGetEnviron() -> *mut *mut *mut i8;
        pub fn clonefile(src: *const i8, dst: *const i8, flags: u32) -> i32;
        pub fn clonefileat(src_dirfd: i32, src: *const i8, dst_dirfd: i32, dst: *const i8, flags: u32) -> i32;
        #[cfg(target_arch = "x86_64")]
        #[link_name = "close$NOCANCEL"]
        pub fn close(fd: i32) -> i32;
        #[cfg(target_arch = "aarch64")]
        pub fn close(fd: i32) -> i32;
        pub fn copyfile(from: *const i8, to: *const i8, state: *mut c_void, flags: u32) -> i32;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn dlclose(handle: *mut c_void) -> i32;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn dlopen(filename: *const i8, flag: i32) -> *mut c_void;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn dlsym(handle: *mut c_void, symbol: *const i8) -> *mut c_void;
        pub fn faccessat(dirfd: i32, pathname: *const i8, mode: i32, flags: i32) -> i32;
        pub fn fchmod(fd: i32, mode: u16) -> i32;
        pub fn fclonefileat(srcfd: i32, dst_dirfd: i32, dst: *const i8, flags: u32) -> i32;
        #[link_name = "bun_host_darwin_fcntl3"]
        pub fn fcntl(fd: i32, cmd: i32, argument: isize) -> i32;
        pub fn fcopyfile(from: i32, to: i32, state: *mut c_void, flags: u32) -> i32;
        pub fn fgetattrlist(fd: i32, attrList: *mut c_void, attrBuf: *mut c_void, attrBufSize: usize, options: u32) -> i32;
        pub fn flock(fd: i32, operation: i32) -> i32;
        #[cfg(target_arch = "x86_64")]
        #[link_name = "fstat$INODE64"]
        pub fn fstat(fildes: i32, buf: *mut stat) -> i32;
        #[cfg(target_arch = "aarch64")]
        pub fn fstat(fildes: i32, buf: *mut stat) -> i32;
        #[cfg(target_arch = "x86_64")]
        #[link_name = "fstatat$INODE64"]
        pub fn fstatat(dirfd: i32, pathname: *const i8, buf: *mut stat, flags: i32) -> i32;
        #[cfg(target_arch = "aarch64")]
        pub fn fstatat(dirfd: i32, pathname: *const i8, buf: *mut stat, flags: i32) -> i32;
        #[cfg(target_arch = "x86_64")]
        #[link_name = "fstatfs$INODE64"]
        pub fn fstatfs(fd: i32, buf: *mut statfs) -> i32;
        #[cfg(target_arch = "aarch64")]
        pub fn fstatfs(fd: i32, buf: *mut statfs) -> i32;
        pub fn fsync(fd: i32) -> i32;
        pub fn ftruncate(fd: i32, length: i64) -> i32;
        pub fn getattrlist(path: *const i8, attrList: *mut c_void, attrBuf: *mut c_void, attrBufSize: usize, options: u32) -> i32;
        pub fn getentropy(buf: *mut c_void, buflen: usize) -> i32;
        pub fn getloadavg(loadavg: *mut f64, nelem: i32) -> i32;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn getpid() -> i32;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn host_processor_info(host: u32, flavor: i32, out_processor_count: *mut u32, out_processor_info: *mut *mut i32, out_processor_infoCnt: *mut u32) -> i32;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn host_statistics64(host_priv: u32, flavor: i32, host_info64_out: *mut i32, host_info64_outCnt: *mut u32) -> i32;
        pub fn kevent(kq: i32, changelist: *const kevent, nchanges: i32, eventlist: *mut kevent, nevents: i32, timeout: *const timespec) -> i32;
        pub fn kevent64(kq: i32, changelist: *const kevent64_s, nchanges: i32, eventlist: *mut kevent64_s, nevents: i32, flags: u32, timeout: *const timespec) -> i32;
        pub fn kqueue() -> i32;
        #[cfg(target_arch = "x86_64")]
        #[link_name = "lstat$INODE64"]
        pub fn lstat(path: *const i8, buf: *mut stat) -> i32;
        #[cfg(target_arch = "aarch64")]
        pub fn lstat(path: *const i8, buf: *mut stat) -> i32;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn mach_absolute_time() -> u64;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn mach_timebase_info(info: *mut mach_timebase_info) -> i32;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn memset_pattern16(b: *mut c_void, pattern16: *const c_void, len: usize);
        #[cfg_attr(bun_portable, no_errno)]
        pub fn memset_pattern4(b: *mut c_void, pattern4: *const c_void, len: usize);
        #[cfg_attr(bun_portable, no_errno)]
        pub fn memset_pattern8(b: *mut c_void, pattern8: *const c_void, len: usize);
        pub fn mkdirat(dirfd: i32, pathname: *const i8, mode: u16) -> i32;
        #[link_name = "bun_host_darwin_open3"]
        pub fn open(path: *const i8, oflag: i32, mode: i32) -> i32;
        #[link_name = "bun_host_darwin_openat4"]
        pub fn openat(dirfd: i32, path: *const i8, oflag: i32, mode: i32) -> i32;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn os_unfair_lock_lock(lock: *mut os_unfair_lock_s);
        #[cfg_attr(bun_portable, no_errno)]
        pub fn os_unfair_lock_trylock(lock: *mut os_unfair_lock_s) -> bool;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn os_unfair_lock_unlock(lock: *mut os_unfair_lock_s);
        #[cfg_attr(bun_portable, no_errno)]
        pub fn posix_spawn_file_actions_addopen(actions: *mut *mut c_void, fd: i32, path: *const i8, oflag: i32, mode: u16) -> i32;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn posix_spawn_file_actions_destroy(actions: *mut *mut c_void) -> i32;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn posix_spawn_file_actions_init(actions: *mut *mut c_void) -> i32;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn posix_spawnp(pid: *mut i32, file: *const i8, file_actions: *const *mut c_void, attrp: *const *mut c_void, argv: *const *mut i8, envp: *const *mut i8) -> i32;
        pub fn pread(fd: i32, buf: *mut c_void, count: usize, offset: i64) -> isize;
        pub fn proc_pidpath(pid: i32, buffer: *mut c_void, buffersize: u32) -> i32;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn pthread_setname_np(name: *const i8) -> i32;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn pthread_threadid_np(thread: usize, thread_id: *mut u64) -> i32;
        pub fn pwrite(fd: i32, buf: *const c_void, count: usize, offset: i64) -> isize;
        pub fn read(fd: i32, buf: *mut c_void, count: usize) -> isize;
        #[link_name = "realpath$DARWIN_EXTSN"]
        pub fn realpath(pathname: *const i8, resolved: *mut i8) -> *mut i8;
        pub fn renameatx_np(fromfd: i32, from: *const i8, tofd: i32, to: *const i8, flags: u32) -> i32;
        pub fn sendfile(fd: i32, s: i32, offset: i64, len: *mut i64, hdtr: *mut sf_hdtr, flags: i32) -> i32;
        pub fn setsockopt(socket: i32, level: i32, name: i32, value: *const c_void, option_len: u32) -> i32;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn sigemptyset(set: *mut u32) -> i32;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn sigwait(set: *const u32, sig: *mut i32) -> i32;
        #[cfg(target_arch = "x86_64")]
        #[link_name = "stat$INODE64"]
        pub fn stat(path: *const i8, buf: *mut stat) -> i32;
        #[cfg(target_arch = "aarch64")]
        pub fn stat(path: *const i8, buf: *mut stat) -> i32;
        #[cfg(target_arch = "x86_64")]
        #[link_name = "statfs$INODE64"]
        pub fn statfs(path: *const i8, buf: *mut statfs) -> i32;
        #[cfg(target_arch = "aarch64")]
        pub fn statfs(path: *const i8, buf: *mut statfs) -> i32;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn strlen(cs: *const i8) -> usize;
        pub fn sysctl(name: *mut i32, namelen: u32, oldp: *mut c_void, oldlenp: *mut usize, newp: *mut c_void, newlen: usize) -> i32;
        pub fn sysctlbyname(name: *const i8, oldp: *mut c_void, oldlenp: *mut usize, newp: *mut c_void, newlen: usize) -> i32;
        pub fn sysctlnametomib(name: *const i8, mibp: *mut i32, sizep: *mut usize) -> i32;
        pub fn truncate(path: *const i8, length: i64) -> i32;
        pub fn unlinkat(dirfd: i32, pathname: *const i8, flags: i32) -> i32;
        #[cfg_attr(bun_portable, no_errno)]
        pub fn vm_deallocate(target_task: u32, address: usize, size: usize) -> i32;
        pub fn write(fd: i32, buf: *const c_void, count: usize) -> isize;
    }
}

/// The functions as the code for macOS gets them. One whose result is an error number gives the number
/// of the image. One that takes a directory descriptor or flags of a family that shared code uses too is
/// not here: `bun_darwin_sys::libc` has it, and translates.
pub(crate) mod functions_for_bun {
    #[allow(unused_imports)]
    use super::types::*;
    #[allow(unused_imports)]
    use core::ffi::c_void;

    pub use super::functions::_NSGetEnviron;
    pub use super::functions::clonefile;
    pub use super::functions::close;
    pub use super::functions::copyfile;
    pub use super::functions::dlclose;
    pub use super::functions::dlopen;
    pub use super::functions::dlsym;
    pub use super::functions::fchmod;
    pub use super::functions::fcopyfile;
    pub use super::functions::fgetattrlist;
    pub use super::functions::flock;
    pub use super::functions::fstat;
    pub use super::functions::fstatfs;
    pub use super::functions::fsync;
    pub use super::functions::ftruncate;
    pub use super::functions::getattrlist;
    pub use super::functions::getentropy;
    pub use super::functions::getloadavg;
    pub use super::functions::getpid;
    pub use super::functions::host_processor_info;
    pub use super::functions::host_statistics64;
    pub use super::functions::kevent;
    pub use super::functions::kevent64;
    pub use super::functions::kqueue;
    pub use super::functions::lstat;
    pub use super::functions::mach_absolute_time;
    pub use super::functions::mach_timebase_info;
    pub use super::functions::memset_pattern16;
    pub use super::functions::memset_pattern4;
    pub use super::functions::memset_pattern8;
    pub use super::functions::os_unfair_lock_lock;
    pub use super::functions::os_unfair_lock_trylock;
    pub use super::functions::os_unfair_lock_unlock;
    /// The result is an error number: the one of the image.
    #[inline]
    pub unsafe fn posix_spawn_file_actions_destroy(actions: *mut *mut c_void) -> i32 {
        crate::errno::to_image(unsafe { super::functions::posix_spawn_file_actions_destroy(actions) })
    }
    /// The result is an error number: the one of the image.
    #[inline]
    pub unsafe fn posix_spawn_file_actions_init(actions: *mut *mut c_void) -> i32 {
        crate::errno::to_image(unsafe { super::functions::posix_spawn_file_actions_init(actions) })
    }
    /// The result is an error number: the one of the image.
    #[inline]
    pub unsafe fn posix_spawnp(pid: *mut i32, file: *const i8, file_actions: *const *mut c_void, attrp: *const *mut c_void, argv: *const *mut i8, envp: *const *mut i8) -> i32 {
        crate::errno::to_image(unsafe { super::functions::posix_spawnp(pid, file, file_actions, attrp, argv, envp) })
    }
    pub use super::functions::pread;
    pub use super::functions::proc_pidpath;
    /// The result is an error number: the one of the image.
    #[inline]
    pub unsafe fn pthread_setname_np(name: *const i8) -> i32 {
        crate::errno::to_image(unsafe { super::functions::pthread_setname_np(name) })
    }
    pub use super::functions::pthread_threadid_np;
    pub use super::functions::pwrite;
    pub use super::functions::read;
    pub use super::functions::realpath;
    pub use super::functions::sendfile;
    pub use super::functions::setsockopt;
    pub use super::functions::sigemptyset;
    /// The result is an error number: the one of the image.
    #[inline]
    pub unsafe fn sigwait(set: *const u32, sig: *mut i32) -> i32 {
        crate::errno::to_image(unsafe { super::functions::sigwait(set, sig) })
    }
    pub use super::functions::stat;
    pub use super::functions::statfs;
    pub use super::functions::strlen;
    pub use super::functions::sysctl;
    pub use super::functions::sysctlbyname;
    pub use super::functions::sysctlnametomib;
    pub use super::functions::truncate;
    pub use super::functions::vm_deallocate;
    pub use super::functions::write;
}

/// The constants as the code for macOS gets them: the values of macOS, and for the families that
/// shared code uses too (error numbers, the flags of open, the flags of the functions that end in
/// `at`) the values of the image, which `bun_darwin_sys::translate` turns into the ones of macOS.
pub(crate) mod constants_for_bun {
    pub const AT_EACCESS: i32 = ::libc::AT_EACCESS as i32;
    pub const AT_FDCWD: i32 = ::libc::AT_FDCWD as i32;
    pub const AT_REMOVEDIR: i32 = ::libc::AT_REMOVEDIR as i32;
    pub const AT_SYMLINK_FOLLOW: i32 = ::libc::AT_SYMLINK_FOLLOW as i32;
    pub const AT_SYMLINK_NOFOLLOW: i32 = ::libc::AT_SYMLINK_NOFOLLOW as i32;
    pub use super::constants::COPYFILE_ACL;
    pub use super::constants::COPYFILE_CHECK;
    pub use super::constants::COPYFILE_CLONE;
    pub use super::constants::COPYFILE_CLONE_FORCE;
    pub use super::constants::COPYFILE_CONTINUE;
    pub use super::constants::COPYFILE_COPY_DATA;
    pub use super::constants::COPYFILE_COPY_XATTR;
    pub use super::constants::COPYFILE_DATA;
    pub use super::constants::COPYFILE_DATA_SPARSE;
    pub use super::constants::COPYFILE_ERR;
    pub use super::constants::COPYFILE_EXCL;
    pub use super::constants::COPYFILE_FINISH;
    pub use super::constants::COPYFILE_METADATA;
    pub use super::constants::COPYFILE_MOVE;
    pub use super::constants::COPYFILE_NOFOLLOW;
    pub use super::constants::COPYFILE_NOFOLLOW_DST;
    pub use super::constants::COPYFILE_NOFOLLOW_SRC;
    pub use super::constants::COPYFILE_PACK;
    pub use super::constants::COPYFILE_PRESERVE_DST_TRACKED;
    pub use super::constants::COPYFILE_PROGRESS;
    pub use super::constants::COPYFILE_QUIT;
    pub use super::constants::COPYFILE_RECURSE_DIR;
    pub use super::constants::COPYFILE_RECURSE_DIR_CLEANUP;
    pub use super::constants::COPYFILE_RECURSE_ERROR;
    pub use super::constants::COPYFILE_RECURSE_FILE;
    pub use super::constants::COPYFILE_RECURSIVE;
    pub use super::constants::COPYFILE_RUN_IN_PLACE;
    pub use super::constants::COPYFILE_SECURITY;
    pub use super::constants::COPYFILE_SKIP;
    pub use super::constants::COPYFILE_START;
    pub use super::constants::COPYFILE_STAT;
    pub use super::constants::COPYFILE_STATE_BSIZE;
    pub use super::constants::COPYFILE_STATE_COPIED;
    pub use super::constants::COPYFILE_STATE_DST_BSIZE;
    pub use super::constants::COPYFILE_STATE_DST_FD;
    pub use super::constants::COPYFILE_STATE_DST_FILENAME;
    pub use super::constants::COPYFILE_STATE_QUARANTINE;
    pub use super::constants::COPYFILE_STATE_SRC_BSIZE;
    pub use super::constants::COPYFILE_STATE_SRC_FD;
    pub use super::constants::COPYFILE_STATE_SRC_FILENAME;
    pub use super::constants::COPYFILE_STATE_STATUS_CB;
    pub use super::constants::COPYFILE_STATE_STATUS_CTX;
    pub use super::constants::COPYFILE_STATE_WAS_CLONED;
    pub use super::constants::COPYFILE_STATE_XATTRNAME;
    pub use super::constants::COPYFILE_UNLINK;
    pub use super::constants::COPYFILE_UNPACK;
    pub use super::constants::COPYFILE_VERBOSE;
    pub use super::constants::COPYFILE_XATTR;
    pub use super::constants::CPU_STATE_IDLE;
    pub use super::constants::CPU_STATE_MAX;
    pub use super::constants::CPU_STATE_NICE;
    pub use super::constants::CPU_STATE_SYSTEM;
    pub use super::constants::CPU_STATE_USER;
    pub use super::constants::DT_BLK;
    pub use super::constants::DT_CHR;
    pub use super::constants::DT_DIR;
    pub use super::constants::DT_FIFO;
    pub use super::constants::DT_LNK;
    pub use super::constants::DT_REG;
    pub use super::constants::DT_SOCK;
    pub use super::constants::DT_UNKNOWN;
    pub const E2BIG: i32 = ::libc::E2BIG as i32;
    pub const EACCES: i32 = ::libc::EACCES as i32;
    pub const EADDRINUSE: i32 = ::libc::EADDRINUSE as i32;
    pub const EADDRNOTAVAIL: i32 = ::libc::EADDRNOTAVAIL as i32;
    pub const EAFNOSUPPORT: i32 = ::libc::EAFNOSUPPORT as i32;
    pub const EAGAIN: i32 = ::libc::EAGAIN as i32;
    pub const EALREADY: i32 = ::libc::EALREADY as i32;
    pub const EAUTH: i32 = ::libc::EACCES as i32;
    pub const EBADARCH: i32 = ::libc::ENOEXEC as i32;
    pub const EBADEXEC: i32 = ::libc::ENOEXEC as i32;
    pub const EBADF: i32 = ::libc::EBADF as i32;
    pub const EBADMACHO: i32 = ::libc::ENOEXEC as i32;
    pub const EBADMSG: i32 = ::libc::EBADMSG as i32;
    pub const EBADRPC: i32 = ::libc::EREMOTEIO as i32;
    pub const EBUSY: i32 = ::libc::EBUSY as i32;
    pub const ECANCELED: i32 = ::libc::ECANCELED as i32;
    pub const ECHILD: i32 = ::libc::ECHILD as i32;
    pub use super::constants::ECHO;
    pub use super::constants::ECHOCTL;
    pub use super::constants::ECHOE;
    pub use super::constants::ECHOK;
    pub use super::constants::ECHOKE;
    pub use super::constants::ECHONL;
    pub use super::constants::ECHOPRT;
    pub const ECONNABORTED: i32 = ::libc::ECONNABORTED as i32;
    pub const ECONNREFUSED: i32 = ::libc::ECONNREFUSED as i32;
    pub const ECONNRESET: i32 = ::libc::ECONNRESET as i32;
    pub const EDEADLK: i32 = ::libc::EDEADLK as i32;
    pub const EDESTADDRREQ: i32 = ::libc::EDESTADDRREQ as i32;
    pub const EDEVERR: i32 = ::libc::EIO as i32;
    pub const EDOM: i32 = ::libc::EDOM as i32;
    pub const EDQUOT: i32 = ::libc::EDQUOT as i32;
    pub const EEXIST: i32 = ::libc::EEXIST as i32;
    pub const EFAULT: i32 = ::libc::EFAULT as i32;
    pub const EFBIG: i32 = ::libc::EFBIG as i32;
    pub const EFTYPE: i32 = 137 as i32;
    pub const EHOSTDOWN: i32 = ::libc::EHOSTDOWN as i32;
    pub const EHOSTUNREACH: i32 = ::libc::EHOSTUNREACH as i32;
    pub const EIDRM: i32 = ::libc::EIDRM as i32;
    pub const EILSEQ: i32 = ::libc::EILSEQ as i32;
    pub const EINPROGRESS: i32 = ::libc::EINPROGRESS as i32;
    pub const EINTR: i32 = ::libc::EINTR as i32;
    pub const EINVAL: i32 = ::libc::EINVAL as i32;
    pub const EIO: i32 = ::libc::EIO as i32;
    pub const EISCONN: i32 = ::libc::EISCONN as i32;
    pub const EISDIR: i32 = ::libc::EISDIR as i32;
    pub use super::constants::ELAST;
    pub const ELOOP: i32 = ::libc::ELOOP as i32;
    pub const EMFILE: i32 = ::libc::EMFILE as i32;
    pub const EMLINK: i32 = ::libc::EMLINK as i32;
    pub use super::constants::EMPTY;
    pub const EMSGSIZE: i32 = ::libc::EMSGSIZE as i32;
    pub const EMULTIHOP: i32 = ::libc::EMULTIHOP as i32;
    pub const ENAMETOOLONG: i32 = ::libc::ENAMETOOLONG as i32;
    pub const ENEEDAUTH: i32 = ::libc::EACCES as i32;
    pub const ENETDOWN: i32 = ::libc::ENETDOWN as i32;
    pub const ENETRESET: i32 = ::libc::ENETRESET as i32;
    pub const ENETUNREACH: i32 = ::libc::ENETUNREACH as i32;
    pub const ENFILE: i32 = ::libc::ENFILE as i32;
    pub const ENOATTR: i32 = ::libc::ENOATTR as i32;
    pub const ENOBUFS: i32 = ::libc::ENOBUFS as i32;
    pub const ENODATA: i32 = ::libc::ENODATA as i32;
    pub const ENODEV: i32 = ::libc::ENODEV as i32;
    pub const ENOENT: i32 = ::libc::ENOENT as i32;
    pub const ENOEXEC: i32 = ::libc::ENOEXEC as i32;
    pub const ENOLCK: i32 = ::libc::ENOLCK as i32;
    pub const ENOLINK: i32 = ::libc::ENOLINK as i32;
    pub const ENOMEM: i32 = ::libc::ENOMEM as i32;
    pub const ENOMSG: i32 = ::libc::ENOMSG as i32;
    pub const ENOPOLICY: i32 = ::libc::EPERM as i32;
    pub const ENOPROTOOPT: i32 = ::libc::ENOPROTOOPT as i32;
    pub const ENOSPC: i32 = ::libc::ENOSPC as i32;
    pub const ENOSR: i32 = ::libc::ENOSR as i32;
    pub const ENOSTR: i32 = ::libc::ENOSTR as i32;
    pub const ENOSYS: i32 = ::libc::ENOSYS as i32;
    pub const ENOTBLK: i32 = ::libc::ENOTBLK as i32;
    pub const ENOTCONN: i32 = ::libc::ENOTCONN as i32;
    pub const ENOTDIR: i32 = ::libc::ENOTDIR as i32;
    pub const ENOTEMPTY: i32 = ::libc::ENOTEMPTY as i32;
    pub const ENOTRECOVERABLE: i32 = ::libc::ENOTRECOVERABLE as i32;
    pub const ENOTSOCK: i32 = ::libc::ENOTSOCK as i32;
    pub const ENOTSUP: i32 = ::libc::ENOTSUP as i32;
    pub const ENOTTY: i32 = ::libc::ENOTTY as i32;
    pub const ENXIO: i32 = ::libc::ENXIO as i32;
    pub use super::constants::EOF;
    pub const EOPNOTSUPP: i32 = ::libc::EOPNOTSUPP as i32;
    pub const EOVERFLOW: i32 = ::libc::EOVERFLOW as i32;
    pub const EOWNERDEAD: i32 = ::libc::EOWNERDEAD as i32;
    pub const EPERM: i32 = ::libc::EPERM as i32;
    pub const EPFNOSUPPORT: i32 = ::libc::EPFNOSUPPORT as i32;
    pub const EPIPE: i32 = ::libc::EPIPE as i32;
    pub const EPROCLIM: i32 = ::libc::EAGAIN as i32;
    pub const EPROCUNAVAIL: i32 = ::libc::EREMOTEIO as i32;
    pub const EPROGMISMATCH: i32 = ::libc::EREMOTEIO as i32;
    pub const EPROGUNAVAIL: i32 = ::libc::EREMOTEIO as i32;
    pub const EPROTO: i32 = ::libc::EPROTO as i32;
    pub const EPROTONOSUPPORT: i32 = ::libc::EPROTONOSUPPORT as i32;
    pub const EPROTOTYPE: i32 = ::libc::EPROTOTYPE as i32;
    pub const EPWROFF: i32 = ::libc::EIO as i32;
    pub const EQFULL: i32 = ::libc::ENOBUFS as i32;
    pub use super::constants::ERA;
    pub const ERANGE: i32 = ::libc::ERANGE as i32;
    pub const EREMOTE: i32 = ::libc::EREMOTE as i32;
    pub const EROFS: i32 = ::libc::EROFS as i32;
    pub const ERPCMISMATCH: i32 = ::libc::EREMOTEIO as i32;
    pub const ESHLIBVERS: i32 = ::libc::ELIBBAD as i32;
    pub const ESHUTDOWN: i32 = ::libc::ESHUTDOWN as i32;
    pub const ESOCKTNOSUPPORT: i32 = ::libc::ESOCKTNOSUPPORT as i32;
    pub const ESPIPE: i32 = ::libc::ESPIPE as i32;
    pub const ESRCH: i32 = ::libc::ESRCH as i32;
    pub const ESTALE: i32 = ::libc::ESTALE as i32;
    pub const ETIME: i32 = ::libc::ETIME as i32;
    pub const ETIMEDOUT: i32 = ::libc::ETIMEDOUT as i32;
    pub const ETOOMANYREFS: i32 = ::libc::ETOOMANYREFS as i32;
    pub const ETXTBSY: i32 = ::libc::ETXTBSY as i32;
    pub const EUSERS: i32 = ::libc::EUSERS as i32;
    pub use super::constants::EV_ADD;
    pub use super::constants::EV_CLEAR;
    pub use super::constants::EV_DELETE;
    pub use super::constants::EV_DISABLE;
    pub use super::constants::EV_DISPATCH;
    pub use super::constants::EV_ENABLE;
    pub use super::constants::EV_EOF;
    pub use super::constants::EV_ERROR;
    pub use super::constants::EV_ONESHOT;
    pub use super::constants::EV_RECEIPT;
    pub use super::constants::EVFILT_MACHPORT;
    pub use super::constants::EVFILT_PROC;
    pub use super::constants::EVFILT_READ;
    pub use super::constants::EVFILT_SIGNAL;
    pub use super::constants::EVFILT_TIMER;
    pub use super::constants::EVFILT_USER;
    pub use super::constants::EVFILT_VNODE;
    pub use super::constants::EVFILT_WRITE;
    pub const EWOULDBLOCK: i32 = ::libc::EWOULDBLOCK as i32;
    pub const EXDEV: i32 = ::libc::EXDEV as i32;
    pub use super::constants::EXTA;
    pub use super::constants::EXTB;
    pub use super::constants::EXTPROC;
    pub use super::constants::F_ALLOCATEALL;
    pub use super::constants::F_ALLOCATECONTIG;
    pub use super::constants::F_BARRIERFSYNC;
    pub use super::constants::F_DUPFD;
    pub use super::constants::F_DUPFD_CLOEXEC;
    pub use super::constants::F_FULLFSYNC;
    pub use super::constants::F_GETFD;
    pub use super::constants::F_GETFL;
    pub use super::constants::F_GETLK;
    pub use super::constants::F_GETPATH;
    pub use super::constants::F_GETPATH_NOFIRMLINK;
    pub use super::constants::F_NOCACHE;
    pub use super::constants::F_OK;
    pub use super::constants::F_PEOFPOSMODE;
    pub use super::constants::F_PREALLOCATE;
    pub use super::constants::F_RDADVISE;
    pub use super::constants::F_RDAHEAD;
    pub use super::constants::F_RDLCK;
    pub use super::constants::F_SETFD;
    pub use super::constants::F_SETFL;
    pub use super::constants::F_SETLK;
    pub use super::constants::F_SETLKW;
    pub use super::constants::F_UNLCK;
    pub use super::constants::F_VOLPOSMODE;
    pub use super::constants::F_WRLCK;
    pub use super::constants::FD_CLOEXEC;
    pub use super::constants::HOST_VM_INFO64;
    pub use super::constants::HOST_VM_INFO64_COUNT;
    pub use super::constants::MAXPATHLEN;
    pub use super::constants::MSG_CTRUNC;
    pub use super::constants::MSG_DONTROUTE;
    pub use super::constants::MSG_DONTWAIT;
    pub use super::constants::MSG_EOF;
    pub use super::constants::MSG_EOR;
    pub use super::constants::MSG_FLUSH;
    pub use super::constants::MSG_HAVEMORE;
    pub use super::constants::MSG_HOLD;
    pub use super::constants::MSG_NEEDSA;
    pub use super::constants::MSG_NOSIGNAL;
    pub use super::constants::MSG_OOB;
    pub use super::constants::MSG_PEEK;
    pub use super::constants::MSG_RCVMORE;
    pub use super::constants::MSG_SEND;
    pub use super::constants::MSG_TRUNC;
    pub use super::constants::MSG_WAITALL;
    pub use super::constants::NOTE_ATTRIB;
    pub use super::constants::NOTE_DELETE;
    pub use super::constants::NOTE_EXEC;
    pub use super::constants::NOTE_EXIT;
    pub use super::constants::NOTE_EXITSTATUS;
    pub use super::constants::NOTE_EXTEND;
    pub use super::constants::NOTE_FORK;
    pub use super::constants::NOTE_LINK;
    pub use super::constants::NOTE_RENAME;
    pub use super::constants::NOTE_REVOKE;
    pub use super::constants::NOTE_SIGNAL;
    pub use super::constants::NOTE_TRIGGER;
    pub use super::constants::NOTE_WRITE;
    pub const O_ACCMODE: i32 = ::libc::O_ACCMODE as i32;
    pub const O_APPEND: i32 = ::libc::O_APPEND as i32;
    pub const O_ASYNC: i32 = ::libc::O_ASYNC as i32;
    pub const O_CLOEXEC: i32 = ::libc::O_CLOEXEC as i32;
    pub const O_CREAT: i32 = ::libc::O_CREAT as i32;
    pub const O_DIRECTORY: i32 = ::libc::O_DIRECTORY as i32;
    pub const O_DSYNC: i32 = ::libc::O_DSYNC as i32;
    pub const O_EVTONLY: i32 = 0x1000000 as i32;
    pub const O_EXCL: i32 = ::libc::O_EXCL as i32;
    pub const O_EXEC: i32 = ::libc::O_EXEC as i32;
    pub const O_EXLOCK: i32 = 0x2000000 as i32;
    pub const O_FSYNC: i32 = 0x4000000 as i32;
    pub const O_NDELAY: i32 = ::libc::O_NDELAY as i32;
    pub const O_NOCTTY: i32 = ::libc::O_NOCTTY as i32;
    pub const O_NOFOLLOW: i32 = ::libc::O_NOFOLLOW as i32;
    pub const O_NOFOLLOW_ANY: i32 = 0x8000000 as i32;
    pub const O_NONBLOCK: i32 = ::libc::O_NONBLOCK as i32;
    pub const O_RDONLY: i32 = ::libc::O_RDONLY as i32;
    pub const O_RDWR: i32 = ::libc::O_RDWR as i32;
    pub const O_SEARCH: i32 = ::libc::O_SEARCH as i32;
    pub const O_SHLOCK: i32 = 0x10000000 as i32;
    pub const O_SYMLINK: i32 = 0x20000000 as i32;
    pub const O_SYNC: i32 = ::libc::O_SYNC as i32;
    pub const O_TRUNC: i32 = ::libc::O_TRUNC as i32;
    pub const O_WRONLY: i32 = ::libc::O_WRONLY as i32;
    pub use super::constants::PATH_MAX;
    pub use super::constants::POLLERR;
    pub use super::constants::POLLHUP;
    pub use super::constants::POLLIN;
    pub use super::constants::POLLNVAL;
    pub use super::constants::POLLOUT;
    pub use super::constants::POLLPRI;
    pub use super::constants::POLLRDBAND;
    pub use super::constants::POLLRDNORM;
    pub use super::constants::POLLWRBAND;
    pub use super::constants::POLLWRNORM;
    pub use super::constants::PROCESSOR_CPU_LOAD_INFO;
    pub use super::constants::R_OK;
    pub use super::constants::RENAME_EXCL;
    pub use super::constants::RENAME_SWAP;
    pub use super::constants::S_IEXEC;
    pub use super::constants::S_IFBLK;
    pub use super::constants::S_IFCHR;
    pub use super::constants::S_IFDIR;
    pub use super::constants::S_IFIFO;
    pub use super::constants::S_IFLNK;
    pub use super::constants::S_IFMT;
    pub use super::constants::S_IFREG;
    pub use super::constants::S_IFSOCK;
    pub use super::constants::S_IREAD;
    pub use super::constants::S_IRGRP;
    pub use super::constants::S_IROTH;
    pub use super::constants::S_IRUSR;
    pub use super::constants::S_IRWXG;
    pub use super::constants::S_IRWXO;
    pub use super::constants::S_IRWXU;
    pub use super::constants::S_ISGID;
    pub use super::constants::S_ISUID;
    pub use super::constants::S_ISVTX;
    pub use super::constants::S_IWGRP;
    pub use super::constants::S_IWOTH;
    pub use super::constants::S_IWRITE;
    pub use super::constants::S_IWUSR;
    pub use super::constants::S_IXGRP;
    pub use super::constants::S_IXOTH;
    pub use super::constants::S_IXUSR;
    pub use super::constants::SEEK_CUR;
    pub use super::constants::SEEK_DATA;
    pub use super::constants::SEEK_END;
    pub use super::constants::SEEK_HOLE;
    pub use super::constants::SEEK_SET;
    pub use super::constants::SIGABRT;
    pub use super::constants::SIGALRM;
    pub use super::constants::SIGBUS;
    pub use super::constants::SIGCHLD;
    pub use super::constants::SIGCONT;
    pub use super::constants::SIGEMT;
    pub use super::constants::SIGFPE;
    pub use super::constants::SIGHUP;
    pub use super::constants::SIGILL;
    pub use super::constants::SIGINFO;
    pub use super::constants::SIGINT;
    pub use super::constants::SIGIO;
    pub use super::constants::SIGIOT;
    pub use super::constants::SIGKILL;
    pub use super::constants::SIGNATURE;
    pub use super::constants::SIGPIPE;
    pub use super::constants::SIGPROF;
    pub use super::constants::SIGQUIT;
    pub use super::constants::SIGSEGV;
    pub use super::constants::SIGSTKSZ;
    pub use super::constants::SIGSTOP;
    pub use super::constants::SIGSYS;
    pub use super::constants::SIGTERM;
    pub use super::constants::SIGTRAP;
    pub use super::constants::SIGTSTP;
    pub use super::constants::SIGTTIN;
    pub use super::constants::SIGTTOU;
    pub use super::constants::SIGURG;
    pub use super::constants::SIGUSR1;
    pub use super::constants::SIGUSR2;
    pub use super::constants::SIGVTALRM;
    pub use super::constants::SIGWINCH;
    pub use super::constants::SIGXCPU;
    pub use super::constants::SIGXFSZ;
    pub use super::constants::SO_NOSIGPIPE;
    pub use super::constants::SO_RCVBUF;
    pub use super::constants::SO_SNDBUF;
    pub use super::constants::SOL_SOCKET;
    pub use super::constants::W_OK;
    pub use super::constants::WNOHANG;
    pub use super::constants::WUNTRACED;
    pub use super::constants::X_OK;
}

/// The flags of open and of the functions that end in `at`: (the flag of the image, the flag of macOS).
pub(crate) mod flag_pairs {
    pub(crate) const OPEN: &[(i32, i32)] = &[
        (super::constants_for_bun::O_APPEND, super::constants::O_APPEND),
        (super::constants_for_bun::O_ASYNC, super::constants::O_ASYNC),
        (super::constants_for_bun::O_CLOEXEC, super::constants::O_CLOEXEC),
        (super::constants_for_bun::O_CREAT, super::constants::O_CREAT),
        (super::constants_for_bun::O_DIRECTORY, super::constants::O_DIRECTORY),
        (super::constants_for_bun::O_DSYNC, super::constants::O_DSYNC),
        (super::constants_for_bun::O_EVTONLY, super::constants::O_EVTONLY),
        (super::constants_for_bun::O_EXCL, super::constants::O_EXCL),
        (super::constants_for_bun::O_EXLOCK, super::constants::O_EXLOCK),
        (super::constants_for_bun::O_FSYNC, super::constants::O_FSYNC),
        (super::constants_for_bun::O_NDELAY, super::constants::O_NDELAY),
        (super::constants_for_bun::O_NOCTTY, super::constants::O_NOCTTY),
        (super::constants_for_bun::O_NOFOLLOW, super::constants::O_NOFOLLOW),
        (super::constants_for_bun::O_NOFOLLOW_ANY, super::constants::O_NOFOLLOW_ANY),
        (super::constants_for_bun::O_NONBLOCK, super::constants::O_NONBLOCK),
        (super::constants_for_bun::O_SHLOCK, super::constants::O_SHLOCK),
        (super::constants_for_bun::O_SYMLINK, super::constants::O_SYMLINK),
        (super::constants_for_bun::O_SYNC, super::constants::O_SYNC),
        (super::constants_for_bun::O_TRUNC, super::constants::O_TRUNC),
    ];
    pub(crate) const AT: &[(i32, i32)] = &[
        (super::constants_for_bun::AT_EACCESS, super::constants::AT_EACCESS),
        (super::constants_for_bun::AT_REMOVEDIR, super::constants::AT_REMOVEDIR),
        (super::constants_for_bun::AT_SYMLINK_FOLLOW, super::constants::AT_SYMLINK_FOLLOW),
        (super::constants_for_bun::AT_SYMLINK_NOFOLLOW, super::constants::AT_SYMLINK_NOFOLLOW),
    ];
}

/// The error numbers of macOS by their names, each with its number in the image: the number of the same
/// name there, or of the name that stands for it (misctools/portable/bindings/darwin-errno.json).
pub(crate) mod errno_names {
    pub(crate) const IN_THE_IMAGE: &[(i32, i32)] = &[
        (super::constants::E2BIG, ::libc::E2BIG as i32),
        (super::constants::EACCES, ::libc::EACCES as i32),
        (super::constants::EADDRINUSE, ::libc::EADDRINUSE as i32),
        (super::constants::EADDRNOTAVAIL, ::libc::EADDRNOTAVAIL as i32),
        (super::constants::EAFNOSUPPORT, ::libc::EAFNOSUPPORT as i32),
        (super::constants::EAGAIN, ::libc::EAGAIN as i32),
        (super::constants::EALREADY, ::libc::EALREADY as i32),
        (super::constants::EBADF, ::libc::EBADF as i32),
        (super::constants::EBADMSG, ::libc::EBADMSG as i32),
        (super::constants::EBUSY, ::libc::EBUSY as i32),
        (super::constants::ECANCELED, ::libc::ECANCELED as i32),
        (super::constants::ECHILD, ::libc::ECHILD as i32),
        (super::constants::ECONNABORTED, ::libc::ECONNABORTED as i32),
        (super::constants::ECONNREFUSED, ::libc::ECONNREFUSED as i32),
        (super::constants::ECONNRESET, ::libc::ECONNRESET as i32),
        (super::constants::EDEADLK, ::libc::EDEADLK as i32),
        (super::constants::EDESTADDRREQ, ::libc::EDESTADDRREQ as i32),
        (super::constants::EDOM, ::libc::EDOM as i32),
        (super::constants::EDQUOT, ::libc::EDQUOT as i32),
        (super::constants::EEXIST, ::libc::EEXIST as i32),
        (super::constants::EFAULT, ::libc::EFAULT as i32),
        (super::constants::EFBIG, ::libc::EFBIG as i32),
        (super::constants::EHOSTDOWN, ::libc::EHOSTDOWN as i32),
        (super::constants::EHOSTUNREACH, ::libc::EHOSTUNREACH as i32),
        (super::constants::EIDRM, ::libc::EIDRM as i32),
        (super::constants::EILSEQ, ::libc::EILSEQ as i32),
        (super::constants::EINPROGRESS, ::libc::EINPROGRESS as i32),
        (super::constants::EINTR, ::libc::EINTR as i32),
        (super::constants::EINVAL, ::libc::EINVAL as i32),
        (super::constants::EIO, ::libc::EIO as i32),
        (super::constants::EISCONN, ::libc::EISCONN as i32),
        (super::constants::EISDIR, ::libc::EISDIR as i32),
        (super::constants::ELOOP, ::libc::ELOOP as i32),
        (super::constants::EMFILE, ::libc::EMFILE as i32),
        (super::constants::EMLINK, ::libc::EMLINK as i32),
        (super::constants::EMSGSIZE, ::libc::EMSGSIZE as i32),
        (super::constants::EMULTIHOP, ::libc::EMULTIHOP as i32),
        (super::constants::ENAMETOOLONG, ::libc::ENAMETOOLONG as i32),
        (super::constants::ENETDOWN, ::libc::ENETDOWN as i32),
        (super::constants::ENETRESET, ::libc::ENETRESET as i32),
        (super::constants::ENETUNREACH, ::libc::ENETUNREACH as i32),
        (super::constants::ENFILE, ::libc::ENFILE as i32),
        (super::constants::ENOATTR, ::libc::ENOATTR as i32),
        (super::constants::ENOBUFS, ::libc::ENOBUFS as i32),
        (super::constants::ENODATA, ::libc::ENODATA as i32),
        (super::constants::ENODEV, ::libc::ENODEV as i32),
        (super::constants::ENOENT, ::libc::ENOENT as i32),
        (super::constants::ENOEXEC, ::libc::ENOEXEC as i32),
        (super::constants::ENOLCK, ::libc::ENOLCK as i32),
        (super::constants::ENOLINK, ::libc::ENOLINK as i32),
        (super::constants::ENOMEM, ::libc::ENOMEM as i32),
        (super::constants::ENOMSG, ::libc::ENOMSG as i32),
        (super::constants::ENOPROTOOPT, ::libc::ENOPROTOOPT as i32),
        (super::constants::ENOSPC, ::libc::ENOSPC as i32),
        (super::constants::ENOSR, ::libc::ENOSR as i32),
        (super::constants::ENOSTR, ::libc::ENOSTR as i32),
        (super::constants::ENOSYS, ::libc::ENOSYS as i32),
        (super::constants::ENOTBLK, ::libc::ENOTBLK as i32),
        (super::constants::ENOTCONN, ::libc::ENOTCONN as i32),
        (super::constants::ENOTDIR, ::libc::ENOTDIR as i32),
        (super::constants::ENOTEMPTY, ::libc::ENOTEMPTY as i32),
        (super::constants::ENOTRECOVERABLE, ::libc::ENOTRECOVERABLE as i32),
        (super::constants::ENOTSOCK, ::libc::ENOTSOCK as i32),
        (super::constants::ENOTSUP, ::libc::ENOTSUP as i32),
        (super::constants::ENOTTY, ::libc::ENOTTY as i32),
        (super::constants::ENXIO, ::libc::ENXIO as i32),
        (super::constants::EOPNOTSUPP, ::libc::EOPNOTSUPP as i32),
        (super::constants::EOVERFLOW, ::libc::EOVERFLOW as i32),
        (super::constants::EOWNERDEAD, ::libc::EOWNERDEAD as i32),
        (super::constants::EPERM, ::libc::EPERM as i32),
        (super::constants::EPFNOSUPPORT, ::libc::EPFNOSUPPORT as i32),
        (super::constants::EPIPE, ::libc::EPIPE as i32),
        (super::constants::EPROTO, ::libc::EPROTO as i32),
        (super::constants::EPROTONOSUPPORT, ::libc::EPROTONOSUPPORT as i32),
        (super::constants::EPROTOTYPE, ::libc::EPROTOTYPE as i32),
        (super::constants::ERANGE, ::libc::ERANGE as i32),
        (super::constants::EREMOTE, ::libc::EREMOTE as i32),
        (super::constants::EROFS, ::libc::EROFS as i32),
        (super::constants::ESHUTDOWN, ::libc::ESHUTDOWN as i32),
        (super::constants::ESOCKTNOSUPPORT, ::libc::ESOCKTNOSUPPORT as i32),
        (super::constants::ESPIPE, ::libc::ESPIPE as i32),
        (super::constants::ESRCH, ::libc::ESRCH as i32),
        (super::constants::ESTALE, ::libc::ESTALE as i32),
        (super::constants::ETIME, ::libc::ETIME as i32),
        (super::constants::ETIMEDOUT, ::libc::ETIMEDOUT as i32),
        (super::constants::ETOOMANYREFS, ::libc::ETOOMANYREFS as i32),
        (super::constants::ETXTBSY, ::libc::ETXTBSY as i32),
        (super::constants::EUSERS, ::libc::EUSERS as i32),
        (super::constants::EWOULDBLOCK, ::libc::EWOULDBLOCK as i32),
        (super::constants::EXDEV, ::libc::EXDEV as i32),
        (super::constants::EAUTH, ::libc::EACCES as i32),
        (super::constants::EBADARCH, ::libc::ENOEXEC as i32),
        (super::constants::EBADEXEC, ::libc::ENOEXEC as i32),
        (super::constants::EBADMACHO, ::libc::ENOEXEC as i32),
        (super::constants::EBADRPC, ::libc::EREMOTEIO as i32),
        (super::constants::EDEVERR, ::libc::EIO as i32),
        (super::constants::EFTYPE, 137 as i32),
        (super::constants::ENEEDAUTH, ::libc::EACCES as i32),
        (super::constants::ENOPOLICY, ::libc::EPERM as i32),
        (super::constants::EPROCLIM, ::libc::EAGAIN as i32),
        (super::constants::EPROCUNAVAIL, ::libc::EREMOTEIO as i32),
        (super::constants::EPROGMISMATCH, ::libc::EREMOTEIO as i32),
        (super::constants::EPROGUNAVAIL, ::libc::EREMOTEIO as i32),
        (super::constants::EPWROFF, ::libc::EIO as i32),
        (super::constants::EQFULL, ::libc::ENOBUFS as i32),
        (super::constants::ERPCMISMATCH, ::libc::EREMOTEIO as i32),
        (super::constants::ESHLIBVERS, ::libc::ELIBBAD as i32),
    ];
}
