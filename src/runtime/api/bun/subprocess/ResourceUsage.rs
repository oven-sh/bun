use crate::api::bun::Rusage;
use bun_jsc::{JSGlobalObject, JSValue};
use bun_spawn::RusageFields as _;

/// Builds the `ResourceUsage` object returned by `Subprocess.resourceUsage()`
/// and `Bun.spawnSync().resourceUsage`: own enumerable number properties, so it
/// serializes and spreads like `process.resourceUsage()`.
pub fn create(rusage: &Rusage, global: &JSGlobalObject) -> JSValue {
    // Microseconds fit exactly in a double (2^53 us is ~285 years of CPU time).
    let user = (rusage.utime_sec() * 1_000_000 + rusage.utime_usec()) as f64;
    let system = (rusage.stime_sec() * 1_000_000 + rusage.stime_usec()) as f64;

    let context_switches = JSValue::create_empty_object_with_null_prototype(global);
    context_switches.put(global, b"voluntary", JSValue::js_number(rusage.nvcsw_()));
    context_switches.put(global, b"involuntary", JSValue::js_number(rusage.nivcsw_()));

    let cpu_time = JSValue::create_empty_object_with_null_prototype(global);
    cpu_time.put(global, b"user", JSValue::js_number(user));
    cpu_time.put(global, b"system", JSValue::js_number(system));
    cpu_time.put(global, b"total", JSValue::js_number(user + system));

    let messages = JSValue::create_empty_object_with_null_prototype(global);
    messages.put(global, b"sent", JSValue::js_number(rusage.msgsnd_()));
    messages.put(global, b"received", JSValue::js_number(rusage.msgrcv_()));

    let ops = JSValue::create_empty_object_with_null_prototype(global);
    ops.put(global, b"in", JSValue::js_number(rusage.inblock_()));
    ops.put(global, b"out", JSValue::js_number(rusage.oublock_()));

    let usage = JSValue::create_empty_object(global, 8);
    usage.put(global, b"contextSwitches", context_switches);
    usage.put(global, b"cpuTime", cpu_time);
    usage.put(global, b"maxRSS", JSValue::js_number(rusage.maxrss_()));
    usage.put(global, b"messages", messages);
    usage.put(global, b"ops", ops);
    usage.put(global, b"shmSize", JSValue::js_number(rusage.ixrss_()));
    usage.put(
        global,
        b"signalCount",
        JSValue::js_number(rusage.nsignals_()),
    );
    usage.put(global, b"swapCount", JSValue::js_number(rusage.nswap_()));
    usage
}
