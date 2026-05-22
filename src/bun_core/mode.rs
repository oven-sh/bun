// ─── FileKind / Mode / kind_from_mode (from bun_sys) ──────────────────────
// Zig: src/sys/sys.zig — pure S_IFMT arithmetic, no syscalls (libarchive_sys req).
pub type Mode = u32; // std.posix.mode_t

/// `stat` mode-flag constants and predicates (Zig: `std.posix.S`).
///
/// Values are POSIX-standard octal — frozen since 1988 and identical across
/// linux/darwin/freebsd. Typed against the cross-platform `Mode` (= `u32`)
/// rather than each platform's native `mode_t`, so `Mode`-typed expressions
/// like `S::IRUSR | S::IWUSR` and `(st_mode as u32) & S::IFMT` compile
/// uniformly; the libc-boundary cast to native `mode_t` happens in `bun_sys`.
///
/// Canonical home for the per-OS `bun_errno::posix::S` re-exports (errno
/// depends on bun_core, not vice-versa).
#[allow(non_snake_case)]
pub mod S {
    use super::Mode;

    pub const IFMT: Mode = 0o170000;
    pub const IFSOCK: Mode = 0o140000;
    pub const IFLNK: Mode = 0o120000;
    pub const IFREG: Mode = 0o100000;
    pub const IFBLK: Mode = 0o060000;
    pub const IFDIR: Mode = 0o040000;
    pub const IFCHR: Mode = 0o020000;
    pub const IFIFO: Mode = 0o010000;
    pub const IFWHT: Mode = 0o160000; // BSD/Darwin whiteout

    pub const ISUID: Mode = 0o4000;
    pub const ISGID: Mode = 0o2000;
    pub const ISVTX: Mode = 0o1000;
    pub const IRWXU: Mode = 0o0700;
    pub const IRUSR: Mode = 0o0400;
    pub const IWUSR: Mode = 0o0200;
    pub const IXUSR: Mode = 0o0100;
    pub const IRWXG: Mode = 0o0070;
    pub const IRGRP: Mode = 0o0040;
    pub const IWGRP: Mode = 0o0020;
    pub const IXGRP: Mode = 0o0010;
    pub const IRWXO: Mode = 0o0007;
    pub const IROTH: Mode = 0o0004;
    pub const IWOTH: Mode = 0o0002;
    pub const IXOTH: Mode = 0o0001;

    #[inline]
    pub const fn ISREG(m: Mode) -> bool {
        m & IFMT == IFREG
    }
    #[inline]
    pub const fn ISDIR(m: Mode) -> bool {
        m & IFMT == IFDIR
    }
    #[inline]
    pub const fn ISCHR(m: Mode) -> bool {
        m & IFMT == IFCHR
    }
    #[inline]
    pub const fn ISBLK(m: Mode) -> bool {
        m & IFMT == IFBLK
    }
    #[inline]
    pub const fn ISFIFO(m: Mode) -> bool {
        m & IFMT == IFIFO
    }
    #[inline]
    pub const fn ISLNK(m: Mode) -> bool {
        m & IFMT == IFLNK
    }
    #[inline]
    pub const fn ISSOCK(m: Mode) -> bool {
        m & IFMT == IFSOCK
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FileKind {
    BlockDevice,
    CharacterDevice,
    Directory,
    NamedPipe,
    SymLink,
    File,
    UnixDomainSocket,
    Whiteout,
    Door,
    EventPort,
    Unknown,
}

#[inline]
pub fn kind_from_mode(mode: Mode) -> FileKind {
    match mode & S::IFMT {
        S::IFBLK => FileKind::BlockDevice,
        S::IFCHR => FileKind::CharacterDevice,
        S::IFDIR => FileKind::Directory,
        S::IFIFO => FileKind::NamedPipe,
        S::IFLNK => FileKind::SymLink,
        S::IFREG => FileKind::File,
        S::IFSOCK => FileKind::UnixDomainSocket,
        _ => FileKind::Unknown,
    }
}
