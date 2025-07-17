//! Platform specific APIs for Darwin/macOS
//!
//! If an API can be implemented on multiple platforms,
//! it does not belong in this namespace.

/// Non-cancellable versions of various libc functions are undocumented
/// TODO: explain the $NOCANCEL problem
pub const nocancel = struct {
    const c = std.c;
    pub extern "c" fn @"recvfrom$NOCANCEL"(sockfd: c.fd_t, noalias buf: *anyopaque, len: usize, flags: u32, noalias src_addr: ?*c.sockaddr, noalias addrlen: ?*c.socklen_t) isize;
    pub extern "c" fn @"sendto$NOCANCEL"(sockfd: c.fd_t, buf: *const anyopaque, len: usize, flags: u32, dest_addr: ?*const c.sockaddr, addrlen: c.socklen_t) isize;
    pub extern "c" fn @"fcntl$NOCANCEL"(fd: c.fd_t, cmd: c_int, ...) c_int;
    // pub extern "c" fn @"sendmsg$NOCANCEL"(sockfd: c.fd_t, msg: *const std.x.os.Socket.Message, flags: c_int) isize;
    // pub extern "c" fn @"recvmsg$NOCANCEL"(sockfd: c.fd_t, msg: *std.x.os.Socket.Message, flags: c_int) isize;
    pub extern "c" fn @"connect$NOCANCEL"(sockfd: c.fd_t, sock_addr: *const c.sockaddr, addrlen: c.socklen_t) c_int;
    pub extern "c" fn @"accept$NOCANCEL"(sockfd: c.fd_t, noalias addr: ?*c.sockaddr, noalias addrlen: ?*c.socklen_t) c_int;
    pub extern "c" fn @"accept4$NOCANCEL"(sockfd: c.fd_t, noalias addr: ?*c.sockaddr, noalias addrlen: ?*c.socklen_t, flags: c_uint) c_int;
    pub extern "c" fn @"open$NOCANCEL"(path: [*:0]const u8, oflag: c_uint, ...) c_int;
    // https://opensource.apple.com/source/xnu/xnu-7195.81.3/libsyscall/wrappers/open-base.c
    pub extern "c" fn @"openat$NOCANCEL"(fd: c.fd_t, path: [*:0]const u8, oflag: c_uint, ...) c_int;
    pub extern "c" fn @"read$NOCANCEL"(fd: c.fd_t, buf: [*]u8, nbyte: usize) isize;
    pub extern "c" fn @"pread$NOCANCEL"(fd: c.fd_t, buf: [*]u8, nbyte: usize, offset: c.off_t) isize;
    pub extern "c" fn @"preadv$NOCANCEL"(fd: c.fd_t, uf: [*]std.posix.iovec, count: i32, offset: c.off_t) isize;
    pub extern "c" fn @"readv$NOCANCEL"(fd: c.fd_t, uf: [*]std.posix.iovec, count: i32) isize;
    pub extern "c" fn @"write$NOCANCEL"(fd: c.fd_t, buf: [*]const u8, nbyte: usize) isize;
    pub extern "c" fn @"writev$NOCANCEL"(fd: c.fd_t, buf: [*]const std.posix.iovec_const, count: i32) isize;
    pub extern "c" fn @"pwritev$NOCANCEL"(fd: c.fd_t, buf: [*]const std.posix.iovec_const, count: i32, offset: c.off_t) isize;
    pub extern "c" fn @"poll$NOCANCEL"(fds: [*]std.posix.pollfd, nfds: c_int, timeout: c_int) isize;
    pub extern "c" fn @"ppoll$NOCANCEL"(fds: [*]std.posix.pollfd, nfds: c_int, timeout: ?*const std.posix.timespec, sigmask: ?*const std.posix.sigset_t) isize;
};

pub const OSLog = opaque {
    pub const Category = enum(u8) {
        PointsOfInterest = 0,
        Dynamicity = 1,
        SizeAndThroughput = 2,
        TimeProfile = 3,
        SystemReporting = 4,
        UserCustom = 5,
    };

    // Common subsystems that Instruments recognizes
    pub const Subsystem = struct {
        pub const Network = "com.apple.network";
        pub const FileIO = "com.apple.disk_io";
        pub const Graphics = "com.apple.graphics";
        pub const Memory = "com.apple.memory";
        pub const Performance = "com.apple.performance";
    };

    extern "C" fn os_log_create(subsystem: ?[*:0]const u8, category: ?[*:0]const u8) ?*OSLog;

    pub fn init() ?*OSLog {
        return os_log_create("com.bun.bun", "PointsOfInterest");
    }

    // anything except 0 and ~0 is a valid signpost id
    var signpost_id_counter = std.atomic.Value(u64).init(1);

    pub fn signpost(log: *OSLog, name: i32) Signpost {
        return .{
            .id = signpost_id_counter.fetchAdd(1, .monotonic),
            .name = name,
            .log = log,
        };
    }

    const SignpostType = enum(u8) {
        Event = 0,
        IntervalBegin = 1,
        IntervalEnd = 2,
    };

    pub extern "C" fn Bun__signpost_emit(log: *OSLog, id: u64, signpost_type: SignpostType, name: i32, category: u8) void;

    pub const Signpost = struct {
        id: u64,
        name: i32,
        log: *OSLog,

        pub fn emit(this: *const Signpost, category: Category) void {
            Bun__signpost_emit(this.log, this.id, .Event, this.name, @intFromEnum(category));
        }

        pub const Interval = struct {
            signpost: Signpost,
            category: Category,

            pub fn end(this: *const Interval) void {
                Bun__signpost_emit(this.signpost.log, this.signpost.id, .IntervalEnd, this.signpost.name, @intFromEnum(this.category));
            }
        };

        pub fn interval(this: Signpost, category: Category) Interval {
            Bun__signpost_emit(this.log, this.id, .IntervalBegin, this.name, @intFromEnum(category));
            return Interval{
                .signpost = this,
                .category = category,
            };
        }
    };
};

const std = @import("std");
const bun = @import("bun");
