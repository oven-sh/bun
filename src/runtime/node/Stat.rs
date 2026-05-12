//! Stats and BigIntStats classes from node:fs

use bun_core::Timespec;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

// `bun.sys.PosixStat` — uv-shaped stat struct. Re-exported from `bun_sys` now
// that the crate declares it; `PosixStat::init(&bun_sys::Stat)` handles the
// libc-stat → uv_stat_t field copy on both POSIX and Windows there.
pub use bun_sys::PosixStat;

const MS_PER_S: i64 = bun_core::time::MS_PER_S as i64;
const NS_PER_MS: i64 = bun_core::time::NS_PER_MS as i64;

/// Stats and BigIntStats classes from node:fs
// PORT NOTE: Zig `fn StatType(comptime big: bool) type` → const-generic struct.
// Zig's `const Float = if (big) i64 else f64;` cannot be expressed as a
// const-generic-dependent type alias in stable Rust, so `to_time_ms` is split
// into `to_time_ms_i64` / `to_time_ms_f64` and called from the appropriate
// branch in `stat_to_js`. Diff readers should expect this reshape.
pub struct StatType<const BIG: bool> {
    pub value: PosixStat,
}

type StatTimespec = Timespec;

impl<const BIG: bool> StatType<BIG> {
    // Zig: `pub const new = bun.TrivialNew(@This());` / `bun.TrivialDeinit(@This())`.
    // In Rust the default `Box::new` / `Drop` give identical semantics (mimalloc-backed
    // via the global allocator), so no explicit `new`/`deinit` methods are needed.

    #[inline]
    pub fn init(stat_: &PosixStat) -> Self {
        Self { value: *stat_ }
    }

    #[inline]
    fn to_nanoseconds(ts: StatTimespec) -> u64 {
        // PORT NOTE: Zig rebuilt a `bun.timespec` with `@intCast` on each field; since
        // `StatTimespec == bun.timespec` those casts are identity — call methods on `ts`
        // directly.
        if ts.sec < 0 {
            return ts.ns_signed().max(0) as u64;
        }
        ts.ns()
    }

    // PORT NOTE: reshaped for const-generic type selection — see struct-level note.
    fn to_time_ms_i64(ts: StatTimespec) -> i64 {
        // On windows, Node.js purposefully misinterprets time values
        // > On win32, time is stored in uint64_t and starts from 1601-01-01.
        // > libuv calculates tv_sec and tv_nsec from it and converts to signed long,
        // > which causes Y2038 overflow. On the other platforms it is safe to treat
        // > negative values as pre-epoch time.
        #[cfg(windows)]
        let (tv_sec, tv_nsec): (i64, i64) = (
            ((ts.sec as i32) as u32) as i64,
            ((ts.nsec as i32) as u32) as i64,
        );
        #[cfg(not(windows))]
        let (tv_sec, tv_nsec): (i64, i64) = (ts.sec as i64, ts.nsec as i64);

        let sec: i64 = tv_sec;
        let nsec: i64 = tv_nsec;
        (sec * MS_PER_S).saturating_add(nsec / NS_PER_MS)
    }

    fn to_time_ms_f64(ts: StatTimespec) -> f64 {
        // On windows, Node.js purposefully misinterprets time values
        // > On win32, time is stored in uint64_t and starts from 1601-01-01.
        // > libuv calculates tv_sec and tv_nsec from it and converts to signed long,
        // > which causes Y2038 overflow. On the other platforms it is safe to treat
        // > negative values as pre-epoch time.
        #[cfg(windows)]
        let (tv_sec, tv_nsec): (f64, f64) = (
            ((ts.sec as i32) as u32) as f64,
            ((ts.nsec as i32) as u32) as f64,
        );
        #[cfg(not(windows))]
        let (tv_sec, tv_nsec): (f64, f64) = (ts.sec as f64, ts.nsec as f64);

        // Use floating-point arithmetic to preserve sub-millisecond precision.
        // Node.js returns fractional milliseconds (e.g. 1773248895434.0544).
        let sec_ms: f64 = tv_sec * 1000.0;
        let nsec_ms: f64 = tv_nsec / 1_000_000.0;
        sec_ms + nsec_ms
    }

    fn get_birthtime(stat_: &PosixStat) -> StatTimespec {
        stat_.birthtim
    }

    pub fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Self::stat_to_js(&self.value, global)
    }

    pub fn get_constructor(global: &JSGlobalObject) -> JSValue {
        if BIG {
            Bun__JSBigIntStatsObjectConstructor(global)
        } else {
            Bun__JSStatsObjectConstructor(global)
        }
    }

    fn stat_to_js(stat_: &PosixStat, global: &JSGlobalObject) -> JsResult<JSValue> {
        let a_time = stat_.atime();
        let m_time = stat_.mtime();
        let c_time = stat_.ctime();
        let b_time = Self::get_birthtime(stat_);

        if BIG {
            let atime_ms: i64 = Self::to_time_ms_i64(a_time);
            let mtime_ms: i64 = Self::to_time_ms_i64(m_time);
            let ctime_ms: i64 = Self::to_time_ms_i64(c_time);
            let birthtime_ms: i64 = Self::to_time_ms_i64(b_time);

            return bun_jsc::from_js_host_call(global, || {
                Bun__createJSBigIntStatsObject(
                    global,
                    stat_.dev,
                    stat_.ino,
                    stat_.mode,
                    stat_.nlink,
                    stat_.uid,
                    stat_.gid,
                    stat_.rdev,
                    stat_.size,
                    stat_.blksize,
                    stat_.blocks,
                    atime_ms,
                    mtime_ms,
                    ctime_ms,
                    birthtime_ms,
                    Self::to_nanoseconds(a_time),
                    Self::to_nanoseconds(m_time),
                    Self::to_nanoseconds(c_time),
                    Self::to_nanoseconds(b_time),
                )
            });
        }

        let atime_ms: f64 = Self::to_time_ms_f64(a_time);
        let mtime_ms: f64 = Self::to_time_ms_f64(m_time);
        let ctime_ms: f64 = Self::to_time_ms_f64(c_time);
        let birthtime_ms: f64 = Self::to_time_ms_f64(b_time);

        Ok(Bun__createJSStatsObject(
            global,
            stat_.dev,
            stat_.ino,
            stat_.mode,
            stat_.nlink,
            stat_.uid,
            stat_.gid,
            stat_.rdev,
            stat_.size,
            stat_.blksize,
            stat_.blocks,
            atime_ms,
            mtime_ms,
            ctime_ms,
            birthtime_ms,
        ))
    }
}

unsafe extern "C" {
    safe fn Bun__JSBigIntStatsObjectConstructor(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__JSStatsObjectConstructor(global: &JSGlobalObject) -> JSValue;

    safe fn Bun__createJSStatsObject(
        global: &JSGlobalObject,
        dev: u64,
        ino: u64,
        mode: u64,
        nlink: u64,
        uid: u64,
        gid: u64,
        rdev: u64,
        size: u64,
        blksize: u64,
        blocks: u64,
        atime_ms: f64,
        mtime_ms: f64,
        ctime_ms: f64,
        birthtime_ms: f64,
    ) -> JSValue;

    safe fn Bun__createJSBigIntStatsObject(
        global: &JSGlobalObject,
        dev: u64,
        ino: u64,
        mode: u64,
        nlink: u64,
        uid: u64,
        gid: u64,
        rdev: u64,
        size: u64,
        blksize: u64,
        blocks: u64,
        atime_ms: i64,
        mtime_ms: i64,
        ctime_ms: i64,
        birthtime_ms: i64,
        atime_ns: u64,
        mtime_ns: u64,
        ctime_ns: u64,
        birthtime_ns: u64,
    ) -> JSValue;
}

pub type StatsSmall = StatType<false>;
pub type StatsBig = StatType<true>;

/// Test-only: build a Stats/BigIntStats from a raw u64 ino via the real
/// statToJS path, so regression tests can exercise high-inode values without
/// a filesystem that hands them out.
#[bun_jsc::host_fn]
pub fn create_stats_for_ino(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [ino_arg, big_arg] = frame.arguments_as_array::<2>();
    // SAFETY: all-zero is a valid PosixStat (repr(C) POD with no NonNull/NonZero fields).
    let mut stat_: PosixStat = bun_core::ffi::zeroed();
    stat_.ino = ino_arg.to_uint64_no_truncate();
    Stats::init(&stat_, big_arg.to_boolean()).to_js_newly_created(global)
}

/// Union between `Stats` and `BigIntStats` where the type can be decided at runtime
pub enum Stats {
    Big(StatsBig),
    Small(StatsSmall),
}

impl Stats {
    #[inline]
    pub fn init(stat_: &PosixStat, big: bool) -> Stats {
        if big {
            Stats::Big(StatsBig::init(stat_))
        } else {
            Stats::Small(StatsSmall::init(stat_))
        }
    }

    pub fn to_js_newly_created(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            Stats::Big(v) => v.to_js(global),
            Stats::Small(v) => v.to_js(global),
        }
    }

    // PORT NOTE: Zig defined `Stats.toJS` as a `@compileError` guard to force callers
    // toward `toJSNewlyCreated`. Rust has no inherent-method `compile_error!`; the
    // method is intentionally omitted so misuse is a hard "no method named `to_js`"
    // compile error instead.
}

// ported from: src/runtime/node/Stat.zig
