// Beyond the six scenarios: the sampling profiler. Its thread stops the main thread again and
// again and reads its stack. On Linux that is a signal sent to one thread (bun's WebKit takes
// SIGPWR for it): tgkill in the libc of the image, and sigsuspend in the handler.
// Run: jsc --useDollarVM=1 profiler.js
startSamplingProfiler();
function work(n) {
    var s = 0;
    for (var i = 0; i < n; i++)
        s = (Math.imul(s, 31) + i) | 0;
    return s;
}
noInline(work);
var sum = 0;
for (var r = 0; r < 1500; r++)
    sum = (sum + work(200000)) | 0;
var traces = samplingProfilerStackTraces();
var count = traces && traces.traces ? traces.traces.length : -1;
print("profiler samples " + (count > 0) + ", checksum " + (sum >>> 0).toString(16));
