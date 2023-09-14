const std = @import("std");
const assert = std.debug.assert;
const Platform = @import("root").bun.analytics.GenerateHeader.GeneratePlatform;
const os = struct {
    pub usingnamespace std.os;
    pub const EPERM = 1;
    pub const ENOENT = 2;
    pub const ESRCH = 3;
    pub const EINTR = 4;
    pub const EIO = 5;
    pub const ENXIO = 6;
    pub const E2BIG = 7;
    pub const ENOEXEC = 8;
    pub const EBADF = 9;
    pub const ECHILD = 10;
    pub const EAGAIN = 11;
    pub const ENOMEM = 12;
    pub const EACCES = 13;
    pub const EFAULT = 14;
    pub const ENOTBLK = 15;
    pub const EBUSY = 16;
    pub const EEXIST = 17;
    pub const EXDEV = 18;
    pub const ENODEV = 19;
    pub const ENOTDIR = 20;
    pub const EISDIR = 21;
    pub const EINVAL = 22;
    pub const ENFILE = 23;
    pub const EMFILE = 24;
    pub const ENOTTY = 25;
    pub const ETXTBSY = 26;
    pub const EFBIG = 27;
    pub const ENOSPC = 28;
    pub const ESPIPE = 29;
    pub const EROFS = 30;
    pub const EMLINK = 31;
    pub const EPIPE = 32;
    pub const EDOM = 33;
    pub const ERANGE = 34;
    pub const EDEADLK = 35;
    pub const ENAMETOOLONG = 36;
    pub const ENOLCK = 37;
    pub const ENOSYS = 38;
    pub const ENOTEMPTY = 39;
    pub const ELOOP = 40;
    pub const EWOULDBLOCK = 41;
    pub const ENOMSG = 42;
    pub const EIDRM = 43;
    pub const ECHRNG = 44;
    pub const EL2NSYNC = 45;
    pub const EL3HLT = 46;
    pub const EL3RST = 47;
    pub const ELNRNG = 48;
    pub const EUNATCH = 49;
    pub const ENOCSI = 50;
    pub const EL2HLT = 51;
    pub const EBADE = 52;
    pub const EBADR = 53;
    pub const EXFULL = 54;
    pub const ENOANO = 55;
    pub const EBADRQC = 56;
    pub const EBADSLT = 57;
    pub const EDEADLOCK = 58;
    pub const EBFONT = 59;
    pub const ENOSTR = 60;
    pub const ENODATA = 61;
    pub const ETIME = 62;
    pub const ENOSR = 63;
    pub const ENONET = 64;
    pub const ENOPKG = 65;
    pub const EREMOTE = 66;
    pub const ENOLINK = 67;
    pub const EADV = 68;
    pub const ESRMNT = 69;
    pub const ECOMM = 70;
    pub const EPROTO = 71;
    pub const EMULTIHOP = 72;
    pub const EDOTDOT = 73;
    pub const EBADMSG = 74;
    pub const EOVERFLOW = 75;
    pub const ENOTUNIQ = 76;
    pub const EBADFD = 77;
    pub const EREMCHG = 78;
    pub const ELIBACC = 79;
    pub const ELIBBAD = 80;
    pub const ELIBSCN = 81;
    pub const ELIBMAX = 82;
    pub const ELIBEXEC = 83;
    pub const EILSEQ = 84;
    pub const ERESTART = 85;
    pub const ESTRPIPE = 86;
    pub const EUSERS = 87;
    pub const ENOTSOCK = 88;
    pub const EDESTADDRREQ = 89;
    pub const EMSGSIZE = 90;
    pub const EPROTOTYPE = 91;
    pub const ENOPROTOOPT = 92;
    pub const EPROTONOSUPPORT = 93;
    pub const ESOCKTNOSUPPORT = 94;
    /// For Linux, EOPNOTSUPP is the real value
    /// but it's ~the same and is incompatible across operating systems
    /// https://lists.gnu.org/archive/html/bug-glibc/2002-08/msg00017.html
    pub const ENOTSUP = 95;
    pub const EOPNOTSUPP = ENOTSUP;
    pub const EPFNOSUPPORT = 96;
    pub const EAFNOSUPPORT = 97;
    pub const EADDRINUSE = 98;
    pub const EADDRNOTAVAIL = 99;
    pub const ENETDOWN = 100;
    pub const ENETUNREACH = 101;
    pub const ENETRESET = 102;
    pub const ECONNABORTED = 103;
    pub const ECONNRESET = 104;
    pub const ENOBUFS = 105;
    pub const EISCONN = 106;
    pub const ENOTCONN = 107;
    pub const ESHUTDOWN = 108;
    pub const ETOOMANYREFS = 109;
    pub const ETIMEDOUT = 110;
    pub const ECONNREFUSED = 111;
    pub const EHOSTDOWN = 112;
    pub const EHOSTUNREACH = 113;
    pub const EALREADY = 114;
    pub const EINPROGRESS = 115;
    pub const ESTALE = 116;
    pub const EUCLEAN = 117;
    pub const ENOTNAM = 118;
    pub const ENAVAIL = 119;
    pub const EISNAM = 120;
    pub const EREMOTEIO = 121;
    pub const EDQUOT = 122;
    pub const ENOMEDIUM = 123;
    pub const EMEDIUMTYPE = 124;
    pub const ECANCELED = 125;
    pub const ENOKEY = 126;
    pub const EKEYEXPIRED = 127;
    pub const EKEYREVOKED = 128;
    pub const EKEYREJECTED = 129;
    pub const EOWNERDEAD = 130;
    pub const ENOTRECOVERABLE = 131;
    pub const ERFKILL = 132;
    pub const EHWPOISON = 133;
};

const Features = struct {
    connect_blocking: bool = false,
    close_blocking: bool = false,
    replace_recv_with_readv: bool = false,
    replace_send_with_writev: bool = false,
};

var features = Features{};

pub const Errno = error{
    EPERM,
    ENOENT,
    ESRCH,
    EINTR,
    EIO,
    ENXIO,
    E2BIG,
    ENOEXEC,
    EBADF,
    ECHILD,
    EAGAIN,
    ENOMEM,
    EACCES,
    EFAULT,
    ENOTBLK,
    EBUSY,
    EEXIST,
    EXDEV,
    ENODEV,
    ENOTDIR,
    EISDIR,
    EINVAL,
    ENFILE,
    EMFILE,
    ENOTTY,
    ETXTBSY,
    EFBIG,
    ENOSPC,
    ESPIPE,
    EROFS,
    EMLINK,
    EPIPE,
    EDOM,
    ERANGE,
    EDEADLK,
    ENAMETOOLONG,
    ENOLCK,
    ENOSYS,
    ENOTEMPTY,
    ELOOP,
    EWOULDBLOCK,
    ENOMSG,
    EIDRM,
    ECHRNG,
    EL2NSYNC,
    EL3HLT,
    EL3RST,
    ELNRNG,
    EUNATCH,
    ENOCSI,
    EL2HLT,
    EBADE,
    EBADR,
    EXFULL,
    ENOANO,
    EBADRQC,
    EBADSLT,
    EDEADLOCK,
    EBFONT,
    ENOSTR,
    ENODATA,
    ETIME,
    ENOSR,
    ENONET,
    ENOPKG,
    EREMOTE,
    ENOLINK,
    EADV,
    ESRMNT,
    ECOMM,
    EPROTO,
    EMULTIHOP,
    EDOTDOT,
    EBADMSG,
    EOVERFLOW,
    ENOTUNIQ,
    EBADFD,
    EREMCHG,
    ELIBACC,
    ELIBBAD,
    ELIBSCN,
    ELIBMAX,
    ELIBEXEC,
    EILSEQ,
    ERESTART,
    ESTRPIPE,
    EUSERS,
    ENOTSOCK,
    EDESTADDRREQ,
    EMSGSIZE,
    EPROTOTYPE,
    ENOPROTOOPT,
    EPROTONOSUPPORT,
    ESOCKTNOSUPPORT,
    ENOTSUP,
    EPFNOSUPPORT,
    EAFNOSUPPORT,
    EADDRINUSE,
    EADDRNOTAVAIL,
    ENETDOWN,
    ENETUNREACH,
    ENETRESET,
    ECONNABORTED,
    ECONNRESET,
    ENOBUFS,
    EISCONN,
    ENOTCONN,
    ESHUTDOWN,
    ETOOMANYREFS,
    ETIMEDOUT,
    ECONNREFUSED,
    EHOSTDOWN,
    EHOSTUNREACH,
    EALREADY,
    EINPROGRESS,
    ESTALE,
    EUCLEAN,
    ENOTNAM,
    ENAVAIL,
    EISNAM,
    EREMOTEIO,
    EDQUOT,
    ENOMEDIUM,
    EMEDIUMTYPE,
    ECANCELED,
    ENOKEY,
    EKEYEXPIRED,
    EKEYREVOKED,
    EKEYREJECTED,
    EOWNERDEAD,
    ENOTRECOVERABLE,
    ERFKILL,
    EHWPOISON,
    Unexpected,
};
pub const errno_map: [135]Errno = brk: {
    var errors: [135]Errno = undefined;
    errors[0] = error.Unexpected;
    errors[1] = error.EPERM;
    errors[2] = error.ENOENT;
    errors[3] = error.ESRCH;
    errors[4] = error.EINTR;
    errors[5] = error.EIO;
    errors[6] = error.ENXIO;
    errors[7] = error.E2BIG;
    errors[8] = error.ENOEXEC;
    errors[9] = error.EBADF;
    errors[10] = error.ECHILD;
    errors[11] = error.EAGAIN;
    errors[12] = error.ENOMEM;
    errors[13] = error.EACCES;
    errors[14] = error.EFAULT;
    errors[15] = error.ENOTBLK;
    errors[16] = error.EBUSY;
    errors[17] = error.EEXIST;
    errors[18] = error.EXDEV;
    errors[19] = error.ENODEV;
    errors[20] = error.ENOTDIR;
    errors[21] = error.EISDIR;
    errors[22] = error.EINVAL;
    errors[23] = error.ENFILE;
    errors[24] = error.EMFILE;
    errors[25] = error.ENOTTY;
    errors[26] = error.ETXTBSY;
    errors[27] = error.EFBIG;
    errors[28] = error.ENOSPC;
    errors[29] = error.ESPIPE;
    errors[30] = error.EROFS;
    errors[31] = error.EMLINK;
    errors[32] = error.EPIPE;
    errors[33] = error.EDOM;
    errors[34] = error.ERANGE;
    errors[35] = error.EDEADLK;
    errors[36] = error.ENAMETOOLONG;
    errors[37] = error.ENOLCK;
    errors[38] = error.ENOSYS;
    errors[39] = error.ENOTEMPTY;
    errors[40] = error.ELOOP;
    errors[41] = error.EWOULDBLOCK;
    errors[42] = error.ENOMSG;
    errors[43] = error.EIDRM;
    errors[44] = error.ECHRNG;
    errors[45] = error.EL2NSYNC;
    errors[46] = error.EL3HLT;
    errors[47] = error.EL3RST;
    errors[48] = error.ELNRNG;
    errors[49] = error.EUNATCH;
    errors[50] = error.ENOCSI;
    errors[51] = error.EL2HLT;
    errors[52] = error.EBADE;
    errors[53] = error.EBADR;
    errors[54] = error.EXFULL;
    errors[55] = error.ENOANO;
    errors[56] = error.EBADRQC;
    errors[57] = error.EBADSLT;
    errors[58] = error.EDEADLOCK;
    errors[59] = error.EBFONT;
    errors[60] = error.ENOSTR;
    errors[61] = error.ENODATA;
    errors[62] = error.ETIME;
    errors[63] = error.ENOSR;
    errors[64] = error.ENONET;
    errors[65] = error.ENOPKG;
    errors[66] = error.EREMOTE;
    errors[67] = error.ENOLINK;
    errors[68] = error.EADV;
    errors[69] = error.ESRMNT;
    errors[70] = error.ECOMM;
    errors[71] = error.EPROTO;
    errors[72] = error.EMULTIHOP;
    errors[73] = error.EDOTDOT;
    errors[74] = error.EBADMSG;
    errors[75] = error.EOVERFLOW;
    errors[76] = error.ENOTUNIQ;
    errors[77] = error.EBADFD;
    errors[78] = error.EREMCHG;
    errors[79] = error.ELIBACC;
    errors[80] = error.ELIBBAD;
    errors[81] = error.ELIBSCN;
    errors[82] = error.ELIBMAX;
    errors[83] = error.ELIBEXEC;
    errors[84] = error.EILSEQ;
    errors[85] = error.ERESTART;
    errors[86] = error.ESTRPIPE;
    errors[87] = error.EUSERS;
    errors[88] = error.ENOTSOCK;
    errors[89] = error.EDESTADDRREQ;
    errors[90] = error.EMSGSIZE;
    errors[91] = error.EPROTOTYPE;
    errors[92] = error.ENOPROTOOPT;
    errors[93] = error.EPROTONOSUPPORT;
    errors[94] = error.ESOCKTNOSUPPORT;
    errors[95] = error.ENOTSUP;
    errors[96] = error.EPFNOSUPPORT;
    errors[97] = error.EAFNOSUPPORT;
    errors[98] = error.EADDRINUSE;
    errors[99] = error.EADDRNOTAVAIL;
    errors[100] = error.ENETDOWN;
    errors[101] = error.ENETUNREACH;
    errors[102] = error.ENETRESET;
    errors[103] = error.ECONNABORTED;
    errors[104] = error.ECONNRESET;
    errors[105] = error.ENOBUFS;
    errors[106] = error.EISCONN;
    errors[107] = error.ENOTCONN;
    errors[108] = error.ESHUTDOWN;
    errors[109] = error.ETOOMANYREFS;
    errors[110] = error.ETIMEDOUT;
    errors[111] = error.ECONNREFUSED;
    errors[112] = error.EHOSTDOWN;
    errors[113] = error.EHOSTUNREACH;
    errors[114] = error.EALREADY;
    errors[115] = error.EINPROGRESS;
    errors[116] = error.ESTALE;
    errors[117] = error.EUCLEAN;
    errors[118] = error.ENOTNAM;
    errors[119] = error.ENAVAIL;
    errors[120] = error.EISNAM;
    errors[121] = error.EREMOTEIO;
    errors[122] = error.EDQUOT;
    errors[123] = error.ENOMEDIUM;
    errors[124] = error.EMEDIUMTYPE;
    errors[125] = error.ECANCELED;
    errors[126] = error.ENOKEY;
    errors[127] = error.EKEYEXPIRED;
    errors[128] = error.EKEYREVOKED;
    errors[129] = error.EKEYREJECTED;
    errors[130] = error.EOWNERDEAD;
    errors[131] = error.ENOTRECOVERABLE;
    errors[132] = error.ERFKILL;
    errors[133] = error.EHWPOISON;
    errors[134] = error.Unexpected;
    break :brk errors;
};
pub fn asError(err: anytype) Errno {
    const errnum = if (@typeInfo(@TypeOf(err)) == .Enum)
        @intFromEnum(err)
    else
        err;
    return switch (errnum) {
        1...errno_map.len => errno_map[@as(u8, @intCast(errnum))],
        else => error.Unexpected,
    };
}

const timespec = linux.timespec;
const linux = os.linux;
const IO_Uring = linux.IO_Uring;
const io_uring_cqe = linux.io_uring_cqe;
const io_uring_sqe = linux.io_uring_sqe;

const FIFO = @import("./fifo.zig").FIFO;
const IO = @This();

ring: IO_Uring,

/// Operations not yet submitted to the kernel and waiting on available space in the
/// submission queue.
unqueued: FIFO(Completion) = .{},

/// Completions that are ready to have their callbacks run.
completed: FIFO(Completion) = .{},

next_tick: FIFO(Completion) = .{},
event_fd: linux.fd_t = 0,

eventfd_buf: [16]u8 = undefined,
has_queued: usize = 0,
wakeup_completion: Completion = undefined,

fn queueForWakeup(this: *@This(), comptime Type: type, ctx: Type, comptime cb: anytype) void {
    @memset(&this.eventfd_buf, 0);
    const Callback = struct {
        pub fn callback(that: Type, completion: *Completion, _: ReadError!usize) void {
            var io = @fieldParentPtr(IO, "wakeup_completion", completion);
            io.has_queued -|= 1;
            cb(that);
        }
    };
    this.read(
        Type,
        ctx,
        Callback.callback,
        &this.wakeup_completion,
        this.event_fd,
        &this.eventfd_buf,
        null,
    );
    this.has_queued +|= 1;
}

pub fn wait(this: *@This(), ptr: anytype, comptime onReady: anytype) void {
    // Subscribe to wakeups
    if (this.has_queued == 0) {
        this.queueForWakeup(@TypeOf(ptr), ptr, onReady);
    }

    this.tick() catch {};

    if (this.has_queued == 0) {
        return;
    }
    const submitted = this.ring.flush_sq();
    _ = this.ring.enter(submitted, 1, linux.IORING_ENTER_GETEVENTS) catch 0;
}

pub fn init(entries_: u12, flags: u32, waker: Waker) !IO {
    var ring: IO_Uring = undefined;
    var entries = entries_;

    const kernel = Platform.kernelVersion();

    if (kernel.orderWithoutTag(@TypeOf(kernel){ .major = 5, .minor = 5, .patch = 0 }) == .lt) {
        features.connect_blocking = true;
    }

    if (kernel.orderWithoutTag(@TypeOf(kernel){ .major = 5, .minor = 6, .patch = 0 }) == .lt) {
        features.close_blocking = true;
        features.replace_recv_with_readv = true;
        features.replace_send_with_writev = true;
    }

    var limit = linux.rlimit{ .cur = 0, .max = 0 };

    if (linux.getrlimit(.MEMLOCK, &limit) == 0) {
        if (limit.cur < 16 * 1024) {
            return error.@"memlock is too low. Please increase it to at least 64k";
        }

        if (limit.cur < 128 * 1024) {
            entries = @min(256, entries);
        }
    }

    while (true) {
        ring = IO_Uring.init(entries, flags) catch |err| {
            if (err == error.SystemResources) {
                if (entries <= 8) return error.SystemResources;
                // We divide by 4 instead of 2
                // This way, a child process that uses io_uring can still function
                entries /= 4;
                continue;
            }

            return err;
        };
        break;
    }

    return IO{ .ring = ring, .event_fd = waker.fd };
}

pub fn deinit(self: *IO) void {
    self.ring.deinit();
}

/// Pass all queued submissions to the kernel and peek for completions.
pub fn tick(self: *IO) !void {
    while (self.next_tick.pop()) |completion| {
        completion.complete();
    }
    // We assume that all timeouts submitted by `run_for_ns()` will be reaped by `run_for_ns()`
    // and that `tick()` and `run_for_ns()` cannot be run concurrently.
    // Therefore `timeouts` here will never be decremented and `etime` will always be false.
    var timeouts: usize = 0;
    var etime = false;

    try self.flush(0, &timeouts, &etime);
    assert(etime == false);

    // Flush any SQEs that were queued while running completion callbacks in `flush()`:
    // This is an optimization to avoid delaying submissions until the next tick.
    // At the same time, we do not flush any ready CQEs since SQEs may complete synchronously.
    // We guard against an io_uring_enter() syscall if we know we do not have any queued SQEs.
    // We cannot use `self.ring.sq_ready()` here since this counts flushed and unflushed SQEs.
    const queued = self.ring.sq.sqe_tail -% self.ring.sq.sqe_head;
    if (queued > 0) {
        try self.flush_submissions(0, &timeouts, &etime);
        assert(etime == false);
    }
}

/// Pass all queued submissions to the kernel and run for `nanoseconds`.
/// The `nanoseconds` argument is a u63 to allow coercion to the i64 used
/// in the timespec struct.
pub fn run_for_ns(self: *IO, nanoseconds: u63) !void {
    assert(nanoseconds > 0);

    while (self.next_tick.pop()) |completion| {
        completion.complete();
    }

    // We must use the same clock source used by io_uring (CLOCK_MONOTONIC) since we specify the
    // timeout below as an absolute value. Otherwise, we may deadlock if the clock sources are
    // dramatically different. Any kernel that supports io_uring will support CLOCK_MONOTONIC.
    var current_ts: timespec = undefined;
    os.clock_gettime(os.CLOCK.MONOTONIC, &current_ts) catch unreachable;
    // The absolute CLOCK_MONOTONIC time after which we may return from this function:
    const timeout_ts: timespec = .{
        .tv_sec = current_ts.tv_sec,
        .tv_nsec = current_ts.tv_nsec + nanoseconds,
    };
    var timeouts: usize = 0;
    var etime = false;
    while (!etime) {
        const timeout_sqe = self.ring.get_sqe() catch blk: {
            // The submission queue is full, so flush submissions to make space:
            try self.flush_submissions(0, &timeouts, &etime);
            break :blk self.ring.get_sqe() catch unreachable;
        };
        // Submit an absolute timeout that will be canceled if any other SQE completes first:
        linux.io_uring_prep_timeout(timeout_sqe, &timeout_ts, 1, linux.IORING_TIMEOUT_ABS);
        timeout_sqe.user_data = 0;
        timeouts += 1;
        // The amount of time this call will block is bounded by the timeout we just submitted:
        try self.flush(1, &timeouts, &etime);
    }
    // Reap any remaining timeouts, which reference the timespec in the current stack frame.
    // The busy loop here is required to avoid a potential deadlock, as the kernel determines
    // when the timeouts are pushed to the completion queue, not us.
    while (timeouts > 0) _ = try self.flush_completions(0, &timeouts, &etime);
}

fn flush(self: *IO, wait_nr: u32, timeouts: *usize, etime: *bool) !void {
    // Flush any queued SQEs and reuse the same syscall to wait for completions if required:
    try self.flush_submissions(wait_nr, timeouts, etime);
    // We can now just peek for any CQEs without waiting and without another syscall:
    try self.flush_completions(0, timeouts, etime);
    // Run completions only after all completions have been flushed:
    // Loop on a copy of the linked list, having reset the list first, so that any synchronous
    // append on running a completion is executed only the next time round the event loop,
    // without creating an infinite loop.
    {
        var copy = self.completed;
        self.completed = .{};
        while (copy.pop()) |completion| completion.complete();
    }
    // Again, loop on a copy of the list to avoid an infinite loop:
    {
        var copy = self.unqueued;
        self.unqueued = .{};
        while (copy.pop()) |completion| self.enqueue(completion);
    }
}

fn flush_completions(self: *IO, wait_nr: u32, timeouts: *usize, etime: *bool) !void {
    var cqes: [256]std.os.linux.io_uring_cqe = undefined;
    var completion_byttes = std.mem.asBytes(&cqes);
    @memset(completion_byttes[0..completion_byttes.len], 0);
    var wait_remaining = wait_nr;
    while (true) {
        // Guard against waiting indefinitely (if there are too few requests inflight),
        // especially if this is not the first time round the loop:
        const completed = self.ring.copy_cqes(&cqes, wait_remaining) catch |err| switch (err) {
            error.SignalInterrupt => continue,
            else => return err,
        };
        if (completed > wait_remaining) wait_remaining = 0 else wait_remaining -= completed;
        for (cqes[0..completed]) |cqe| {
            if (cqe.user_data == 0) {
                timeouts.* -= 1;
                // We are only done if the timeout submitted was completed due to time, not if
                // it was completed due to the completion of an event, in which case `cqe.res`
                // would be 0. It is possible for multiple timeout operations to complete at the
                // same time if the nanoseconds value passed to `run_for_ns()` is very short.
                if (-cqe.res == os.ETIME) etime.* = true;
                continue;
            }
            const completion = @as(*Completion, @ptrFromInt(@as(usize, @intCast(cqe.user_data))));
            completion.result = cqe.res;
            // We do not run the completion here (instead appending to a linked list) to avoid:
            // * recursion through `flush_submissions()` and `flush_completions()`,
            // * unbounded stack usage, and
            // * confusing stack traces.
            self.completed.push(completion);
        }
        if (completed < cqes.len) break;
    }
}

fn flush_submissions(self: *IO, wait_nr: u32, timeouts: *usize, etime: *bool) !void {
    while (true) {
        _ = self.ring.submit_and_wait(wait_nr) catch |err| switch (err) {
            error.SignalInterrupt => continue,
            // Wait for some completions and then try again:
            // See https://github.com/axboe/liburing/issues/281 re: error.SystemResources.
            // Be careful also that copy_cqes() will flush before entering to wait (it does):
            // https://github.com/axboe/liburing/commit/35c199c48dfd54ad46b96e386882e7ac341314c5
            error.CompletionQueueOvercommitted, error.SystemResources => {
                try self.flush_completions(1, timeouts, etime);
                continue;
            },
            else => return err,
        };
        break;
    }
}

fn enqueue(self: *IO, completion: *Completion) void {
    const sqe = self.ring.get_sqe() catch |err| switch (err) {
        error.SubmissionQueueFull => {
            self.unqueued.push(completion);
            return;
        },
    };
    completion.prep(sqe);
}

/// This struct holds the data needed for a single io_uring operation
pub const Completion = struct {
    io: *IO,
    result: i32 = undefined,
    next: ?*Completion = null,
    operation: Operation,
    // This is one of the usecases for anyopaque outside of C code and as such anyopaque will
    // be replaced with anyopaque eventually: https://github.com/ziglang/zig/issues/323
    context: ?*anyopaque,
    callback: *const fn (context: ?*anyopaque, completion: *Completion, result: *const anyopaque) void,

    fn prep(completion: *Completion, sqe: *io_uring_sqe) void {
        switch (completion.operation) {
            .accept => |*op| {
                linux.io_uring_prep_accept(
                    sqe,
                    op.socket,
                    &op.address,
                    &op.address_size,
                    os.SOCK.CLOEXEC,
                );
            },
            .close => |op| {
                linux.io_uring_prep_close(sqe, op.fd);
            },
            .connect => |*op| {
                linux.io_uring_prep_connect(
                    sqe,
                    op.socket,
                    &op.address.any,
                    op.address.getOsSockLen(),
                );
            },
            .fsync => |op| {
                linux.io_uring_prep_fsync(sqe, op.fd, 0);
            },
            .read => |op| {
                linux.io_uring_prep_read(
                    sqe,
                    op.fd,
                    op.buffer[0..buffer_limit(op.buffer.len)],
                    op.offset,
                );
            },
            .open => |op| {
                linux.io_uring_prep_openat(
                    sqe,
                    linux.AT.FDCWD,
                    op.path,
                    op.flags,
                    op.mode,
                );
            },
            .readev => {
                var op = &completion.operation.readev;
                linux.io_uring_prep_readv(sqe, op.socket, &op.iovecs, 0);
            },
            .writev => {
                var op = &completion.operation.writev;
                linux.io_uring_prep_writev(sqe, op.socket, &op.iovecs, 0);
            },
            .recv => |op| {
                linux.io_uring_prep_recv(sqe, op.socket, op.buffer, os.MSG.NOSIGNAL);
            },
            .send => |op| {
                linux.io_uring_prep_send(sqe, op.socket, op.buffer, os.MSG.NOSIGNAL);
            },
            .timeout => {
                var op = &completion.operation.timeout;
                linux.io_uring_prep_timeout(sqe, &op.timespec, 0, 0);
            },
            .write => |op| {
                linux.io_uring_prep_write(
                    sqe,
                    op.fd,
                    op.buffer[0..buffer_limit(op.buffer.len)],
                    op.offset,
                );
            },
        }
        sqe.user_data = @intFromPtr(completion);
    }

    fn complete(completion: *Completion) void {
        switch (completion.operation) {
            .accept => {
                const result: AcceptError!os.socket_t = if (completion.result < 0) switch (-completion.result) {
                    os.EINTR => {
                        completion.io.enqueue(completion);
                        return;
                    },
                    os.EAGAIN => error.WouldBlock,
                    os.EBADF => error.FileDescriptorInvalid,
                    os.ECONNABORTED => error.ConnectionAborted,
                    os.EINVAL => error.SocketNotListening,
                    os.EMFILE => error.ProcessFdQuotaExceeded,
                    os.ENFILE => error.SystemFdQuotaExceeded,
                    os.ENOBUFS => error.SystemResources,
                    os.ENOMEM => error.SystemResources,
                    os.ENOTSOCK => error.FileDescriptorNotASocket,
                    os.EOPNOTSUPP => error.OperationNotSupported,
                    os.EPERM => error.PermissionDenied,
                    os.EPROTO => error.ProtocolFailure,
                    else => |errno| asError(errno),
                } else @as(os.socket_t, @intCast(completion.result));
                completion.callback(completion.context, completion, &result);
            },

            .close => {
                const result = if (completion.result < 0) switch (-completion.result) {
                    os.EINTR => {}, // A success, see https://github.com/ziglang/zig/issues/2425
                    os.EBADF => error.FileDescriptorInvalid,
                    os.EDQUOT => error.DiskQuota,
                    os.EIO => error.InputOutput,
                    os.ENOSPC => error.NoSpaceLeft,
                    else => |errno| asError(errno),
                } else assert(completion.result == 0);
                completion.callback(completion.context, completion, &result);
            },
            .open => {
                const result: OpenError!linux.fd_t = if (completion.result < 0) switch (-completion.result) {
                    0 => unreachable,
                    os.EAGAIN, os.EINPROGRESS, os.EINTR => {
                        completion.io.enqueue(completion);
                        return;
                    },
                    os.EACCES => error.AccessDenied,
                    os.EFBIG => error.FileTooBig,
                    os.EOVERFLOW => error.FileTooBig,
                    os.EISDIR => error.IsDir,
                    os.ELOOP => error.SymLinkLoop,
                    os.EMFILE => error.ProcessFdQuotaExceeded,
                    os.ENAMETOOLONG => error.NameTooLong,
                    os.ENFILE => error.SystemFdQuotaExceeded,
                    os.ENODEV => error.NoDevice,
                    os.ENOENT => error.FileNotFound,
                    os.ENOMEM => error.SystemResources,
                    os.ENOSPC => error.NoSpaceLeft,
                    os.ENOTDIR => error.NotDir,
                    os.EPERM => error.AccessDenied,
                    os.EEXIST => error.PathAlreadyExists,
                    os.EBUSY => error.DeviceBusy,
                    else => |errno| asError(errno),
                } else @as(linux.fd_t, @intCast(completion.result));
                completion.callback(completion.context, completion, &result);
            },
            .connect => {
                const result: ConnectError!void = if (completion.result < 0) switch (-completion.result) {
                    os.EAGAIN, os.EINPROGRESS, os.EINTR => {
                        completion.io.enqueue(completion);
                        return;
                    },
                    os.EACCES => error.AccessDenied,
                    os.EADDRINUSE => error.AddressInUse,
                    os.EADDRNOTAVAIL => error.AddressNotAvailable,
                    os.EAFNOSUPPORT => error.AddressFamilyNotSupported,
                    os.EALREADY => error.OpenAlreadyInProgress,
                    os.EBADF => error.FileDescriptorInvalid,
                    os.ECONNREFUSED => error.ConnectionRefused,
                    os.ECONNRESET => error.ConnectionResetByPeer,
                    os.EISCONN => error.AlreadyConnected,
                    os.ENETUNREACH => error.NetworkUnreachable,
                    os.ENOENT => error.FileNotFound,
                    os.ENOTSOCK => error.FileDescriptorNotASocket,
                    os.EPERM => error.PermissionDenied,
                    os.EPROTOTYPE => error.ProtocolNotSupported,
                    os.ETIMEDOUT => error.ConnectionTimedOut,
                    else => |errno| asError(errno),
                } else assert(completion.result == 0);
                completion.callback(completion.context, completion, &result);
            },
            .fsync => {
                const result: FsyncError!void = if (completion.result < 0) switch (-completion.result) {
                    os.EINTR => {
                        completion.io.enqueue(completion);
                        return;
                    },
                    os.EBADF => error.FileDescriptorInvalid,
                    os.EDQUOT => error.DiskQuota,
                    os.EINVAL => error.ArgumentsInvalid,
                    os.EIO => error.InputOutput,
                    os.ENOSPC => error.NoSpaceLeft,
                    os.EROFS => error.ReadOnlyFileSystem,
                    else => |errno| asError(errno),
                } else assert(completion.result == 0);
                completion.callback(completion.context, completion, &result);
            },
            .read => {
                const result: ReadError!usize = if (completion.result < 0) switch (-completion.result) {
                    os.EAGAIN, os.EINTR => {
                        completion.io.enqueue(completion);
                        return;
                    },
                    os.EBADF => error.NotOpenForReading,
                    os.ECONNRESET => error.ConnectionResetByPeer,
                    os.EINVAL => error.Alignment,
                    os.EIO => error.InputOutput,
                    os.EISDIR => error.IsDir,
                    os.ENOBUFS => error.SystemResources,
                    os.ENOMEM => error.SystemResources,
                    os.ENXIO => error.Unseekable,
                    os.EOVERFLOW => error.Unseekable,
                    os.ESPIPE => error.Unseekable,
                    else => |errno| asError(errno),
                } else @as(usize, @intCast(completion.result));
                completion.callback(completion.context, completion, &result);
            },
            .readev, .recv => {
                const result: RecvError!usize = if (completion.result < 0) switch (-completion.result) {
                    os.EAGAIN, os.EINTR => {
                        completion.io.enqueue(completion);
                        return;
                    },
                    os.EBADF => error.FileDescriptorInvalid,
                    os.ECONNREFUSED => error.ConnectionRefused,
                    os.ENOMEM => error.SystemResources,
                    os.ENOTCONN => error.SocketNotConnected,
                    os.ENOTSOCK => error.FileDescriptorNotASocket,
                    os.ECONNRESET => error.ConnectionResetByPeer,
                    else => |errno| asError(errno),
                } else @as(usize, @intCast(completion.result));
                completion.callback(completion.context, completion, &result);
            },
            .writev, .send => {
                const result: SendError!usize = if (completion.result < 0) switch (-completion.result) {
                    os.EAGAIN, os.EINTR => {
                        completion.io.enqueue(completion);
                        return;
                    },
                    os.EACCES => error.AccessDenied,
                    os.EALREADY => error.FastOpenAlreadyInProgress,
                    os.EAFNOSUPPORT => error.AddressFamilyNotSupported,
                    os.EBADF => error.FileDescriptorInvalid,
                    os.ECONNRESET => error.ConnectionResetByPeer,
                    os.EMSGSIZE => error.MessageTooBig,
                    os.ENOBUFS => error.SystemResources,
                    os.ENOMEM => error.SystemResources,
                    os.ENOTCONN => error.SocketNotConnected,
                    os.ENOTSOCK => error.FileDescriptorNotASocket,
                    os.EOPNOTSUPP => error.OperationNotSupported,
                    os.EPIPE => error.BrokenPipe,
                    else => |errno| asError(errno),
                } else @as(usize, @intCast(completion.result));
                completion.callback(completion.context, completion, &result);
            },
            .timeout => {
                const result: TimeoutError!void = if (completion.result < 0) switch (-completion.result) {
                    os.EINTR => {
                        completion.io.enqueue(completion);
                        return;
                    },
                    os.ECANCELED => error.Canceled,
                    os.ETIME => {}, // A success.
                    else => |errno| asError(errno),
                } else {};
                completion.callback(completion.context, completion, &result);
            },
            .write => {
                const result: WriteError!usize = if (completion.result < 0) switch (-completion.result) {
                    os.EINTR => {
                        completion.io.enqueue(completion);
                        return;
                    },
                    os.EAGAIN => error.WouldBlock,
                    os.EBADF => error.NotOpenForWriting,
                    os.EDESTADDRREQ => error.NotConnected,
                    os.EDQUOT => error.DiskQuota,
                    os.EFBIG => error.FileTooBig,
                    os.EINVAL => error.Alignment,
                    os.EIO => error.InputOutput,
                    os.ENOSPC => error.NoSpaceLeft,
                    os.ENXIO => error.Unseekable,
                    os.EOVERFLOW => error.Unseekable,
                    os.EPERM => error.AccessDenied,
                    os.EPIPE => error.BrokenPipe,
                    os.ESPIPE => error.Unseekable,
                    else => |errno| asError(errno),
                } else @as(usize, @intCast(completion.result));
                completion.callback(completion.context, completion, &result);
            },
        }
    }
};

pub const Waker = struct {
    fd: os.fd_t,

    pub fn init(allocator: std.mem.Allocator) !Waker {
        return initWithFileDescriptor(allocator, @as(os.fd_t, @intCast(try std.os.eventfd(0, 0))));
    }

    pub fn initWithFileDescriptor(_: std.mem.Allocator, fd: os.fd_t) Waker {
        return Waker{
            .fd = fd,
        };
    }

    pub fn wait(this: Waker) !u64 {
        var bytes: usize = 0;
        _ = std.os.read(this.fd, @as(*[8]u8, @ptrCast(&bytes))) catch 0;
        return @as(u64, @intCast(bytes));
    }

    pub fn wake(this: *const Waker) !void {
        var bytes: usize = 1;
        _ = std.os.write(
            this.fd,
            @as(*[8]u8, @ptrCast(&bytes)),
        ) catch 0;
    }
};

/// This union encodes the set of operations supported as well as their arguments.
const Operation = union(enum) {
    accept: struct {
        socket: os.socket_t,
        address: os.sockaddr = undefined,
        address_size: os.socklen_t = @sizeOf(os.sockaddr),
    },
    close: struct {
        fd: os.fd_t,
    },
    connect: struct {
        socket: os.socket_t,
        address: std.net.Address,
    },
    fsync: struct {
        fd: os.fd_t,
    },
    open: struct {
        path: [*:0]const u8,
        flags: u32,
        mode: os.mode_t,
    },
    read: struct {
        fd: os.fd_t,
        buffer: []u8,
        offset: u64,
    },
    readev: struct {
        socket: os.socket_t,
        iovecs: [1]os.iovec,
    },
    writev: struct {
        socket: os.socket_t,
        iovecs: [1]os.iovec_const,
    },
    recv: struct {
        socket: os.socket_t,
        buffer: []u8,
    },
    send: struct {
        socket: os.socket_t,
        buffer: []const u8,
    },
    timeout: struct {
        timespec: linux.timespec,
    },
    write: struct {
        fd: os.fd_t,
        buffer: []const u8,
        offset: u64,
    },

    pub fn slice(this: Operation) []const u8 {
        return switch (this) {
            .write => |op| op.buffer,
            .send => |op| op.buffer,
            .recv => |op| op.buffer,
            .read => |op| op.buffer,
            else => &[_]u8{},
        };
    }
};

pub const AcceptError = error{
    WouldBlock,
    FileDescriptorInvalid,
    ConnectionAborted,
    SocketNotListening,
    ProcessFdQuotaExceeded,
    SystemFdQuotaExceeded,
    SystemResources,
    FileDescriptorNotASocket,
    OperationNotSupported,
    PermissionDenied,
    ProtocolFailure,
} || Errno;

pub fn accept(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
        context: Context,
        completion: *Completion,
        result: AcceptError!os.socket_t,
    ) void,
    completion: *Completion,
    socket: os.socket_t,
) void {
    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @as(Context, @ptrFromInt(@intFromPtr(ctx))),
                    comp,
                    @as(*const AcceptError!os.socket_t, @ptrFromInt(@intFromPtr(res))).*,
                );
            }
        }.wrapper,
        .operation = .{
            .accept = .{
                .socket = socket,
                .address = undefined,
                .address_size = @sizeOf(os.sockaddr),
            },
        },
    };
    self.enqueueNew(completion);
}

pub const CloseError = error{
    FileDescriptorInvalid,
    DiskQuota,
    InputOutput,
    NoSpaceLeft,
} || Errno;

pub fn close(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
        context: Context,
        completion: *Completion,
        result: CloseError!void,
    ) void,
    completion: *Completion,
    fd: os.fd_t,
) void {
    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @as(Context, @ptrFromInt(@intFromPtr(ctx))),
                    comp,
                    @as(*const CloseError!void, @ptrFromInt(@intFromPtr(res))).*,
                );
            }
        }.wrapper,
        .operation = .{ .close = .{ .fd = fd } },
    };

    if (features.close_blocking) {
        const rc = linux.close(fd);
        completion.result = @as(i32, @intCast(rc));
        self.next_tick.push(completion);
        return;
    }

    self.enqueueNew(completion);
}

pub const ConnectError = error{
    AccessDenied,
    AddressInUse,
    AddressNotAvailable,
    AddressFamilyNotSupported,
    WouldBlock,
    OpenAlreadyInProgress,
    FileDescriptorInvalid,
    ConnectionRefused,
    AlreadyConnected,
    NetworkUnreachable,
    FileNotFound,
    FileDescriptorNotASocket,
    PermissionDenied,
    ProtocolNotSupported,
    ConnectionTimedOut,
    ConnectionResetByPeer,
} || Errno;

pub fn connect(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
        context: Context,
        completion: *Completion,
        result: ConnectError!void,
    ) void,
    completion: *Completion,
    socket: os.socket_t,
    address: std.net.Address,
) void {
    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @as(Context, @ptrFromInt(@intFromPtr(ctx))),
                    comp,
                    @as(*const ConnectError!void, @ptrFromInt(@intFromPtr(res))).*,
                );
            }
        }.wrapper,
        .operation = .{
            .connect = .{
                .socket = socket,
                .address = address,
            },
        },
    };

    if (features.connect_blocking) {
        const rc = linux.connect(socket, &address.any, address.getOsSockLen());
        completion.result = @as(i32, @intCast(rc));
        self.completed.push(completion);
        return;
    }

    self.enqueueNew(completion);
}

pub const FsyncError = error{
    FileDescriptorInvalid,
    DiskQuota,
    ArgumentsInvalid,
    InputOutput,
    NoSpaceLeft,
    ReadOnlyFileSystem,
} || Errno;

pub fn fsync(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
        context: Context,
        completion: *Completion,
        result: FsyncError!void,
    ) void,
    completion: *Completion,
    fd: os.fd_t,
) void {
    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @as(Context, @ptrFromInt(@intFromPtr(ctx))),
                    comp,
                    @as(*const FsyncError!void, @ptrFromInt(@intFromPtr(res))).*,
                );
            }
        }.wrapper,
        .operation = .{
            .fsync = .{
                .fd = fd,
            },
        },
    };
    self.enqueueNew(completion);
}

pub const ReadError = error{
    WouldBlock,
    NotOpenForReading,
    ConnectionResetByPeer,
    Alignment,
    InputOutput,
    IsDir,
    SystemResources,
    Unseekable,
} || Errno;

pub fn read(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
        context: Context,
        completion: *Completion,
        result: ReadError!usize,
    ) void,
    completion: *Completion,
    fd: os.fd_t,
    buffer: []u8,
    offset: ?u64,
) void {
    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @as(Context, @ptrFromInt(@intFromPtr(ctx))),
                    comp,
                    @as(*const ReadError!usize, @ptrFromInt(@intFromPtr(res))).*,
                );
            }
        }.wrapper,
        .operation = .{
            .read = .{
                .fd = fd,
                .buffer = buffer,
                // pread is irrelevant here
                .offset = offset orelse 0,
            },
        },
    };
    self.enqueueNew(completion);
}

pub const RecvError = error{
    WouldBlock,
    FileDescriptorInvalid,
    ConnectionRefused,
    SystemResources,
    SocketNotConnected,
    FileDescriptorNotASocket,
    ConnectionResetByPeer,
} || Errno;

pub fn recv(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
        context: Context,
        completion: *Completion,
        result: RecvError!usize,
    ) void,
    completion: *Completion,
    socket: os.socket_t,
    buffer: []u8,
) void {
    if (features.replace_recv_with_readv) {
        readev(self, Context, context, callback, completion, socket, buffer);
        return;
    }

    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @as(Context, @ptrFromInt(@intFromPtr(ctx))),
                    comp,
                    @as(*const RecvError!usize, @ptrFromInt(@intFromPtr(res))).*,
                );
            }
        }.wrapper,
        .operation = .{
            .recv = .{
                .socket = socket,
                .buffer = buffer,
            },
        },
    };
    self.enqueueNew(completion);
}

pub fn readev(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
        context: Context,
        completion: *Completion,
        result: RecvError!usize,
    ) void,
    completion: *Completion,
    socket: os.socket_t,
    buffer: []u8,
) void {
    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @as(Context, @ptrFromInt(@intFromPtr(ctx))),
                    comp,
                    @as(*const RecvError!usize, @ptrFromInt(@intFromPtr(res))).*,
                );
            }
        }.wrapper,
        .operation = .{
            .readev = .{
                .socket = socket,
                .iovecs = .{.{ .iov_base = buffer.ptr, .iov_len = buffer.len }},
            },
        },
    };
    self.enqueueNew(completion);
}

pub const SendError = error{
    AccessDenied,
    WouldBlock,
    FastOpenAlreadyInProgress,
    AddressFamilyNotSupported,
    FileDescriptorInvalid,
    ConnectionResetByPeer,
    MessageTooBig,
    SystemResources,
    SocketNotConnected,
    FileDescriptorNotASocket,
    OperationNotSupported,
    BrokenPipe,
} || Errno;

pub fn send(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
        context: Context,
        completion: *Completion,
        result: SendError!usize,
    ) void,
    completion: *Completion,
    socket: os.socket_t,
    buffer: []const u8,
    _: u32,
) void {
    if (features.replace_send_with_writev) {
        writev(self, Context, context, callback, completion, socket, buffer, 0);
        return;
    }

    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @as(Context, @ptrFromInt(@intFromPtr(ctx))),
                    comp,
                    @as(*const SendError!usize, @ptrFromInt(@intFromPtr(res))).*,
                );
            }
        }.wrapper,
        .operation = .{
            .send = .{
                .socket = socket,
                .buffer = buffer,
            },
        },
    };
    self.enqueueNew(completion);
}

pub const OpenError = error{
    /// In WASI, this error may occur when the file descriptor does
    /// not hold the required rights to open a new resource relative to it.
    AccessDenied,
    SymLinkLoop,
    ProcessFdQuotaExceeded,
    SystemFdQuotaExceeded,
    NoDevice,
    FileNotFound,

    /// The path exceeded `MAX_PATH_BYTES` bytes.
    NameTooLong,

    /// Insufficient kernel memory was available, or
    /// the named file is a FIFO and per-user hard limit on
    /// memory allocation for pipes has been reached.
    SystemResources,

    /// The file is too large to be opened. This error is unreachable
    /// for 64-bit targets, as well as when opening directories.
    FileTooBig,

    /// The path refers to directory but the `O.DIRECTORY` flag was not provided.
    IsDir,

    /// A new path cannot be created because the device has no room for the new file.
    /// This error is only reachable when the `O.CREAT` flag is provided.
    NoSpaceLeft,

    /// A component used as a directory in the path was not, in fact, a directory, or
    /// `O.DIRECTORY` was specified and the path was not a directory.
    NotDir,

    /// The path already exists and the `O.CREAT` and `O.EXCL` flags were provided.
    PathAlreadyExists,
    DeviceBusy,

    /// The underlying filesystem does not support file locks
    FileLocksNotSupported,

    BadPathName,
    InvalidUtf8,

    /// One of these three things:
    /// * pathname  refers to an executable image which is currently being
    ///   executed and write access was requested.
    /// * pathname refers to a file that is currently in  use  as  a  swap
    ///   file, and the O_TRUNC flag was specified.
    /// * pathname  refers  to  a file that is currently being read by the
    ///   kernel (e.g., for module/firmware loading), and write access was
    ///   requested.
    FileBusy,

    WouldBlock,
} || Errno;

pub fn open(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
        context: Context,
        completion: *Completion,
        result: OpenError!linux.fd_t,
    ) void,
    completion: *Completion,
    path: [:0]const u8,
    flags: os.mode_t,
    mode: os.mode_t,
) void {
    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @as(Context, @ptrFromInt(@intFromPtr(ctx))),
                    comp,
                    @as(*const OpenError!linux.fd_t, @ptrFromInt(@intFromPtr(res))).*,
                );
            }
        }.wrapper,
        .operation = .{
            .open = .{
                .path = path,
                .flags = @as(u32, @intCast(flags)),
                .mode = mode,
            },
        },
    };
    self.enqueueNew(completion);
}

pub fn writev(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
        context: Context,
        completion: *Completion,
        result: SendError!usize,
    ) void,
    completion: *Completion,
    socket: os.socket_t,
    buffer: []const u8,
    _: u32,
) void {
    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @as(Context, @ptrFromInt(@intFromPtr(ctx))),
                    comp,
                    @as(*const SendError!usize, @ptrFromInt(@intFromPtr(res))).*,
                );
            }
        }.wrapper,
        .operation = .{
            .writev = .{
                .socket = socket,
                .iovecs = .{
                    .{ .iov_base = buffer.ptr, .iov_len = buffer.len },
                },
            },
        },
    };
    self.enqueueNew(completion);
}

pub const TimeoutError = error{Canceled} || Errno;

pub fn timeout(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
        context: Context,
        completion: *Completion,
        result: TimeoutError!void,
    ) void,
    completion: *Completion,
    nanoseconds: u63,
) void {
    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @as(Context, @ptrFromInt(@intFromPtr(ctx))),
                    comp,
                    @as(*const TimeoutError!void, @ptrFromInt(@intFromPtr(res))).*,
                );
            }
        }.wrapper,
        .operation = .{
            .timeout = .{
                .timespec = .{ .tv_sec = 0, .tv_nsec = nanoseconds },
            },
        },
    };
    self.enqueueNew(completion);
}

pub const WriteError = error{
    WouldBlock,
    NotOpenForWriting,
    NotConnected,
    DiskQuota,
    FileTooBig,
    Alignment,
    InputOutput,
    NoSpaceLeft,
    Unseekable,
    AccessDenied,
    BrokenPipe,
} || Errno;

pub fn write(
    self: *IO,
    comptime Context: type,
    context: Context,
    comptime callback: *const fn (
        context: Context,
        completion: *Completion,
        result: WriteError!usize,
    ) void,
    completion: *Completion,
    fd: os.fd_t,
    buffer: []const u8,
    offset: u64,
) void {
    completion.* = .{
        .io = self,
        .context = context,
        .callback = struct {
            fn wrapper(ctx: ?*anyopaque, comp: *Completion, res: *const anyopaque) void {
                callback(
                    @as(Context, @ptrFromInt(@intFromPtr(ctx))),
                    comp,
                    @as(*const WriteError!usize, @ptrFromInt(@intFromPtr(res))).*,
                );
            }
        }.wrapper,
        .operation = .{
            .write = .{
                .fd = fd,
                .buffer = buffer,
                .offset = offset,
            },
        },
    };
    self.enqueueNew(completion);
}

inline fn enqueueNew(self: *IO, completion: *Completion) void {
    self.enqueue(completion);
}

pub fn wake(self: *IO, completion: *Completion) void {
    self.enqueue(completion);
}

const SocketError = error{
    AddressFamilyNotSupported,
    ProtocolFamilyNotAvailable,
    ProcessFdQuotaExceeded,
    SystemFdQuotaExceeded,
    SystemResources,
    ProtocolNotSupported,
    SocketTypeNotSupported,
    PermissionDenied,
} || Errno;

const Syscall = struct {
    pub fn socket(domain: u32, socket_type: u32, protocol: u32) SocketError!os.socket_t {
        const rc = linux.socket(domain, socket_type, protocol);
        return switch (linux.getErrno((rc))) {
            .SUCCESS => @as(os.fd_t, @intCast(rc)),
            .ACCES => return error.PermissionDenied,
            .AFNOSUPPORT => return error.AddressFamilyNotSupported,
            .INVAL => return error.ProtocolFamilyNotAvailable,
            .MFILE => return error.ProcessFdQuotaExceeded,
            .NFILE => return error.SystemFdQuotaExceeded,
            .NOBUFS => return error.SystemResources,
            .NOMEM => return error.SystemResources,
            .PROTONOSUPPORT => return error.ProtocolNotSupported,
            .PROTOTYPE => return error.SocketTypeNotSupported,
            else => |err| return asError(@intFromEnum(err)),
        };
    }
};

pub fn openSocket(family: u32, sock_type: u32, protocol: u32) !os.socket_t {
    return Syscall.socket(family, sock_type | os.SOCK.CLOEXEC | os.SOCK.NONBLOCK, protocol);
}

pub var global: IO = undefined;
pub var global_loaded: bool = false;

fn buffer_limit(buffer_len: usize) usize {

    // Linux limits how much may be written in a `pwrite()/pread()` call, which is `0x7ffff000` on
    // both 64-bit and 32-bit systems, due to using a signed C int as the return value, as well as
    // stuffing the errno codes into the last `4096` values.
    // Darwin limits writes to `0x7fffffff` bytes, more than that returns `EINVAL`.
    // The corresponding POSIX limit is `std.math.maxInt(isize)`.
    const limit = switch (@import("builtin").target.os.tag) {
        .linux => 0x7ffff000,
        .macos, .ios, .watchos, .tvos => std.math.maxInt(i32),
        else => std.math.maxInt(isize),
    };
    return @min(limit, buffer_len);
}
