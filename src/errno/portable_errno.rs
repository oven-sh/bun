//! `E` in the portable image.
//!
//! A build for POSIX has one enum, `SystemErrno`, and `E` is its other name. A build for Windows has two
//! enums with the same numbers: `SystemErrno` spells `ENOENT`, `E` spells `NOENT`. The numbers of
//! Windows are the numbers of Linux, and three codes and the codes of libuv after them, so the portable
//! image has the `SystemErrno` of Windows on every host, and `E` is its other name, as on POSIX. The
//! code for Windows finds the short names here.

use crate::windows_errno::SystemErrno;

pub type E = SystemErrno;

#[allow(non_upper_case_globals)]
impl SystemErrno {
    pub const PERM: SystemErrno = SystemErrno::EPERM;
    pub const NOENT: SystemErrno = SystemErrno::ENOENT;
    pub const SRCH: SystemErrno = SystemErrno::ESRCH;
    pub const INTR: SystemErrno = SystemErrno::EINTR;
    pub const IO: SystemErrno = SystemErrno::EIO;
    pub const NXIO: SystemErrno = SystemErrno::ENXIO;
    pub const _2BIG: SystemErrno = SystemErrno::E2BIG;
    pub const NOEXEC: SystemErrno = SystemErrno::ENOEXEC;
    pub const BADF: SystemErrno = SystemErrno::EBADF;
    pub const CHILD: SystemErrno = SystemErrno::ECHILD;
    pub const AGAIN: SystemErrno = SystemErrno::EAGAIN;
    pub const NOMEM: SystemErrno = SystemErrno::ENOMEM;
    pub const ACCES: SystemErrno = SystemErrno::EACCES;
    pub const FAULT: SystemErrno = SystemErrno::EFAULT;
    pub const NOTBLK: SystemErrno = SystemErrno::ENOTBLK;
    pub const BUSY: SystemErrno = SystemErrno::EBUSY;
    pub const EXIST: SystemErrno = SystemErrno::EEXIST;
    pub const XDEV: SystemErrno = SystemErrno::EXDEV;
    pub const NODEV: SystemErrno = SystemErrno::ENODEV;
    pub const NOTDIR: SystemErrno = SystemErrno::ENOTDIR;
    pub const ISDIR: SystemErrno = SystemErrno::EISDIR;
    pub const INVAL: SystemErrno = SystemErrno::EINVAL;
    pub const NFILE: SystemErrno = SystemErrno::ENFILE;
    pub const MFILE: SystemErrno = SystemErrno::EMFILE;
    pub const NOTTY: SystemErrno = SystemErrno::ENOTTY;
    pub const TXTBSY: SystemErrno = SystemErrno::ETXTBSY;
    pub const FBIG: SystemErrno = SystemErrno::EFBIG;
    pub const NOSPC: SystemErrno = SystemErrno::ENOSPC;
    pub const SPIPE: SystemErrno = SystemErrno::ESPIPE;
    pub const ROFS: SystemErrno = SystemErrno::EROFS;
    pub const MLINK: SystemErrno = SystemErrno::EMLINK;
    pub const PIPE: SystemErrno = SystemErrno::EPIPE;
    pub const DOM: SystemErrno = SystemErrno::EDOM;
    pub const RANGE: SystemErrno = SystemErrno::ERANGE;
    pub const DEADLK: SystemErrno = SystemErrno::EDEADLK;
    pub const NAMETOOLONG: SystemErrno = SystemErrno::ENAMETOOLONG;
    pub const NOLCK: SystemErrno = SystemErrno::ENOLCK;
    pub const NOSYS: SystemErrno = SystemErrno::ENOSYS;
    pub const NOTEMPTY: SystemErrno = SystemErrno::ENOTEMPTY;
    pub const LOOP: SystemErrno = SystemErrno::ELOOP;
    pub const WOULDBLOCK: SystemErrno = SystemErrno::EWOULDBLOCK;
    pub const NOMSG: SystemErrno = SystemErrno::ENOMSG;
    pub const IDRM: SystemErrno = SystemErrno::EIDRM;
    pub const CHRNG: SystemErrno = SystemErrno::ECHRNG;
    pub const L2NSYNC: SystemErrno = SystemErrno::EL2NSYNC;
    pub const L3HLT: SystemErrno = SystemErrno::EL3HLT;
    pub const L3RST: SystemErrno = SystemErrno::EL3RST;
    pub const LNRNG: SystemErrno = SystemErrno::ELNRNG;
    pub const UNATCH: SystemErrno = SystemErrno::EUNATCH;
    pub const NOCSI: SystemErrno = SystemErrno::ENOCSI;
    pub const L2HLT: SystemErrno = SystemErrno::EL2HLT;
    pub const BADE: SystemErrno = SystemErrno::EBADE;
    pub const BADR: SystemErrno = SystemErrno::EBADR;
    pub const XFULL: SystemErrno = SystemErrno::EXFULL;
    pub const NOANO: SystemErrno = SystemErrno::ENOANO;
    pub const BADRQC: SystemErrno = SystemErrno::EBADRQC;
    pub const BADSLT: SystemErrno = SystemErrno::EBADSLT;
    pub const DEADLOCK: SystemErrno = SystemErrno::EDEADLOCK;
    pub const BFONT: SystemErrno = SystemErrno::EBFONT;
    pub const NOSTR: SystemErrno = SystemErrno::ENOSTR;
    pub const NODATA: SystemErrno = SystemErrno::ENODATA;
    pub const TIME: SystemErrno = SystemErrno::ETIME;
    pub const NOSR: SystemErrno = SystemErrno::ENOSR;
    pub const NONET: SystemErrno = SystemErrno::ENONET;
    pub const NOPKG: SystemErrno = SystemErrno::ENOPKG;
    pub const REMOTE: SystemErrno = SystemErrno::EREMOTE;
    pub const NOLINK: SystemErrno = SystemErrno::ENOLINK;
    pub const ADV: SystemErrno = SystemErrno::EADV;
    pub const SRMNT: SystemErrno = SystemErrno::ESRMNT;
    pub const COMM: SystemErrno = SystemErrno::ECOMM;
    pub const PROTO: SystemErrno = SystemErrno::EPROTO;
    pub const MULTIHOP: SystemErrno = SystemErrno::EMULTIHOP;
    pub const DOTDOT: SystemErrno = SystemErrno::EDOTDOT;
    pub const BADMSG: SystemErrno = SystemErrno::EBADMSG;
    pub const OVERFLOW: SystemErrno = SystemErrno::EOVERFLOW;
    pub const NOTUNIQ: SystemErrno = SystemErrno::ENOTUNIQ;
    pub const BADFD: SystemErrno = SystemErrno::EBADFD;
    pub const REMCHG: SystemErrno = SystemErrno::EREMCHG;
    pub const LIBACC: SystemErrno = SystemErrno::ELIBACC;
    pub const LIBBAD: SystemErrno = SystemErrno::ELIBBAD;
    pub const LIBSCN: SystemErrno = SystemErrno::ELIBSCN;
    pub const LIBMAX: SystemErrno = SystemErrno::ELIBMAX;
    pub const LIBEXEC: SystemErrno = SystemErrno::ELIBEXEC;
    pub const ILSEQ: SystemErrno = SystemErrno::EILSEQ;
    pub const RESTART: SystemErrno = SystemErrno::ERESTART;
    pub const STRPIPE: SystemErrno = SystemErrno::ESTRPIPE;
    pub const USERS: SystemErrno = SystemErrno::EUSERS;
    pub const NOTSOCK: SystemErrno = SystemErrno::ENOTSOCK;
    pub const DESTADDRREQ: SystemErrno = SystemErrno::EDESTADDRREQ;
    pub const MSGSIZE: SystemErrno = SystemErrno::EMSGSIZE;
    pub const PROTOTYPE: SystemErrno = SystemErrno::EPROTOTYPE;
    pub const NOPROTOOPT: SystemErrno = SystemErrno::ENOPROTOOPT;
    pub const PROTONOSUPPORT: SystemErrno = SystemErrno::EPROTONOSUPPORT;
    pub const SOCKTNOSUPPORT: SystemErrno = SystemErrno::ESOCKTNOSUPPORT;
    pub const NOTSUP: SystemErrno = SystemErrno::ENOTSUP;
    pub const PFNOSUPPORT: SystemErrno = SystemErrno::EPFNOSUPPORT;
    pub const AFNOSUPPORT: SystemErrno = SystemErrno::EAFNOSUPPORT;
    pub const ADDRINUSE: SystemErrno = SystemErrno::EADDRINUSE;
    pub const ADDRNOTAVAIL: SystemErrno = SystemErrno::EADDRNOTAVAIL;
    pub const NETDOWN: SystemErrno = SystemErrno::ENETDOWN;
    pub const NETUNREACH: SystemErrno = SystemErrno::ENETUNREACH;
    pub const NETRESET: SystemErrno = SystemErrno::ENETRESET;
    pub const CONNABORTED: SystemErrno = SystemErrno::ECONNABORTED;
    pub const CONNRESET: SystemErrno = SystemErrno::ECONNRESET;
    pub const NOBUFS: SystemErrno = SystemErrno::ENOBUFS;
    pub const ISCONN: SystemErrno = SystemErrno::EISCONN;
    pub const NOTCONN: SystemErrno = SystemErrno::ENOTCONN;
    pub const SHUTDOWN: SystemErrno = SystemErrno::ESHUTDOWN;
    pub const TOOMANYREFS: SystemErrno = SystemErrno::ETOOMANYREFS;
    pub const TIMEDOUT: SystemErrno = SystemErrno::ETIMEDOUT;
    pub const CONNREFUSED: SystemErrno = SystemErrno::ECONNREFUSED;
    pub const HOSTDOWN: SystemErrno = SystemErrno::EHOSTDOWN;
    pub const HOSTUNREACH: SystemErrno = SystemErrno::EHOSTUNREACH;
    pub const ALREADY: SystemErrno = SystemErrno::EALREADY;
    pub const INPROGRESS: SystemErrno = SystemErrno::EINPROGRESS;
    pub const STALE: SystemErrno = SystemErrno::ESTALE;
    pub const UCLEAN: SystemErrno = SystemErrno::EUCLEAN;
    pub const NOTNAM: SystemErrno = SystemErrno::ENOTNAM;
    pub const NAVAIL: SystemErrno = SystemErrno::ENAVAIL;
    pub const ISNAM: SystemErrno = SystemErrno::EISNAM;
    pub const REMOTEIO: SystemErrno = SystemErrno::EREMOTEIO;
    pub const DQUOT: SystemErrno = SystemErrno::EDQUOT;
    pub const NOMEDIUM: SystemErrno = SystemErrno::ENOMEDIUM;
    pub const MEDIUMTYPE: SystemErrno = SystemErrno::EMEDIUMTYPE;
    pub const CANCELED: SystemErrno = SystemErrno::ECANCELED;
    pub const NOKEY: SystemErrno = SystemErrno::ENOKEY;
    pub const KEYEXPIRED: SystemErrno = SystemErrno::EKEYEXPIRED;
    pub const KEYREVOKED: SystemErrno = SystemErrno::EKEYREVOKED;
    pub const KEYREJECTED: SystemErrno = SystemErrno::EKEYREJECTED;
    pub const OWNERDEAD: SystemErrno = SystemErrno::EOWNERDEAD;
    pub const NOTRECOVERABLE: SystemErrno = SystemErrno::ENOTRECOVERABLE;
    pub const RFKILL: SystemErrno = SystemErrno::ERFKILL;
    pub const HWPOISON: SystemErrno = SystemErrno::EHWPOISON;
    pub const UNKNOWN: SystemErrno = SystemErrno::EUNKNOWN;
    pub const CHARSET: SystemErrno = SystemErrno::ECHARSET;
    pub const FTYPE: SystemErrno = SystemErrno::EFTYPE;

    /// `None` for a number that is no variant.
    #[inline]
    pub fn try_from_raw(n: u16) -> Option<SystemErrno> {
        SystemErrno::from_repr(n)
    }
}
