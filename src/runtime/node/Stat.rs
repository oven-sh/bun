//! Stats and BigIntStats classes from node:fs

use bun_core::Timespec;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

// `bun.sys.PosixStat` — uv-shaped stat struct. Re-exported from `bun_sys` now
// that the crate declares it; `PosixStat::init(&bun_sys::Stat)` handles the
// libc-stat → uv_stat_t field copy on both POSIX and Windows there.
pub use bun_sys::PosixStat;

/// Stats and BigIntStats classes from node:fs. `BIG` selects BigIntStats vs Stats.
pub struct StatType<const BIG: bool> {
    pub value: PosixStat,
}

type StatTimespec = Timespec;

impl<const BIG: bool> StatType<BIG> {
    // The default `Box::new` / `Drop` give the needed semantics (mimalloc-backed
    // via the global allocator), so no explicit `new`/`deinit` methods are needed.

    #[inline]
    pub(crate) fn init(stat_: &PosixStat) -> Self {
        Self { value: *stat_ }
    }

    /// Matches Node's `static_cast<unsigned long>` of stat times: 32-bit wrap on win32, signed-preserving elsewhere.
    #[inline]
    fn timespec_parts(ts: StatTimespec) -> (i64, i64) {
        #[cfg(windows)]
        return (
            ((ts.sec as i32) as u32) as i64,
            ((ts.nsec as i32) as u32) as i64,
        );
        #[cfg(not(windows))]
        (ts.sec, ts.nsec)
    }

    fn to_time_ms_f64(ts: StatTimespec) -> f64 {
        let (sec, nsec) = Self::timespec_parts(ts);
        // Floating-point to preserve sub-millisecond precision (e.g. 1773248895434.0544).
        (sec as f64) * 1000.0 + (nsec as f64) / 1_000_000.0
    }

    fn get_birthtime(stat_: &PosixStat) -> StatTimespec {
        stat_.birthtim
    }

    pub(crate) fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Self::stat_to_js(&self.value, global)
    }

    pub(crate) fn get_constructor(global: &JSGlobalObject) -> JSValue {
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
            let (a_sec, a_nsec) = Self::timespec_parts(a_time);
            let (m_sec, m_nsec) = Self::timespec_parts(m_time);
            let (c_sec, c_nsec) = Self::timespec_parts(c_time);
            let (b_sec, b_nsec) = Self::timespec_parts(b_time);

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
                    a_sec,
                    a_nsec,
                    m_sec,
                    m_nsec,
                    c_sec,
                    c_nsec,
                    b_sec,
                    b_nsec,
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
        atime_sec: i64,
        atime_nsec: i64,
        mtime_sec: i64,
        mtime_nsec: i64,
        ctime_sec: i64,
        ctime_nsec: i64,
        birthtime_sec: i64,
        birthtime_nsec: i64,
    ) -> JSValue;
}

pub type StatsSmall = StatType<false>;
pub type StatsBig = StatType<true>;

/// Test-only: build a Stats/BigIntStats from a raw u64 ino via the real
/// statToJS path, so regression tests can exercise high-inode values without
/// a filesystem that hands them out.
#[bun_jsc::host_fn]
pub(crate) fn create_stats_for_ino(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
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
    pub(crate) fn init(stat_: &PosixStat, big: bool) -> Stats {
        if big {
            Stats::Big(StatsBig::init(stat_))
        } else {
            Stats::Small(StatsSmall::init(stat_))
        }
    }

    pub(crate) fn to_js_newly_created(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            Stats::Big(v) => v.to_js(global),
            Stats::Small(v) => v.to_js(global),
        }
    }

    // A `to_js` method is intentionally omitted to force callers toward
    // `to_js_newly_created` — misuse is a hard "no method named `to_js`"
    // compile error.
}
