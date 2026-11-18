/// From some moment before the process started. It never goes back.
#[inline]
pub fn monotonic_seconds() -> f64 {
    #[cfg(target_os = "macos")]
    return seconds_on(libc::CLOCK_UPTIME_RAW);
    #[cfg(all(unix, not(target_os = "macos")))]
    return seconds_on(libc::CLOCK_MONOTONIC);
    #[cfg(windows)]
    return performance_counter_seconds();
}

/// From the Unix epoch.
#[inline]
pub fn wall_seconds() -> f64 {
    #[cfg(unix)]
    return seconds_on(libc::CLOCK_REALTIME);
    #[cfg(windows)]
    return system_time_ticks() as f64 / 1e7;
}

/// The same, rounded down.
#[inline]
pub fn wall_milliseconds() -> i64 {
    #[cfg(unix)]
    return milliseconds_on(libc::CLOCK_REALTIME);
    #[cfg(windows)]
    return system_time_ticks().div_euclid(10_000);
}

#[cfg(unix)]
#[inline]
fn seconds_on(clock: libc::clockid_t) -> f64 {
    let time = read(clock);
    time.tv_sec as f64 + time.tv_nsec as f64 / 1e9
}

#[cfg(unix)]
#[inline]
fn milliseconds_on(clock: libc::clockid_t) -> i64 {
    let time = read(clock);
    time.tv_sec * 1000 + i64::from(time.tv_nsec as u32 / 1_000_000)
}

#[cfg(unix)]
#[inline]
fn read(clock: libc::clockid_t) -> libc::timespec {
    unsafe extern "C" {
        safe fn clock_gettime(clock: libc::clockid_t, time: &mut libc::timespec) -> libc::c_int;
    }
    let mut time = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    clock_gettime(clock, &mut time);
    time
}

#[cfg(windows)]
fn performance_counter_seconds() -> f64 {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        safe fn QueryPerformanceCounter(ticks: &mut i64) -> i32;
        safe fn QueryPerformanceFrequency(ticks_per_second: &mut i64) -> i32;
    }
    static SECONDS_PER_TICK: std::sync::LazyLock<f64> = std::sync::LazyLock::new(|| {
        let mut frequency = 1;
        QueryPerformanceFrequency(&mut frequency);
        1.0 / frequency as f64
    });
    let mut ticks = 0;
    QueryPerformanceCounter(&mut ticks);
    ticks as f64 * *SECONDS_PER_TICK
}

#[cfg(windows)]
fn system_time_ticks() -> i64 {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        safe fn GetSystemTimePreciseAsFileTime(ticks: &mut u64);
    }
    const TICKS_FROM_1601_TO_1970: u64 = 116_444_736_000_000_000;
    let mut ticks = 0;
    GetSystemTimePreciseAsFileTime(&mut ticks);
    ticks.wrapping_sub(TICKS_FROM_1601_TO_1970) as i64
}
