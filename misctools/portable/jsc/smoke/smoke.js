// Smoke test for the jsc shell (portable-ABI spike). Run: jsc --useDollarVM=1 smoke.js
// Prints one line per check: "<name>: <value>"; the last line is "SMOKE <n> passed, <m> failed".
var passed = 0, failed = 0;
function check(name, got, want) {
    var ok = (typeof want === "function") ? want(got) : (got === want);
    if (ok) passed++; else failed++;
    print((ok ? "ok   " : "FAIL ") + name + ": " + got + (ok ? "" : "   (wanted " + want + ")"));
}

// 1. print
print("hello from jsc");
check("print", 1 + 1, 2);

// 2. tiers: LLInt -> Baseline -> DFG -> FTL, observed from inside the function
var saw = { llint: 0, baseline: 0, dfg: 0, ftl: 0 };
function hot(a, k) {
    var s = 0;
    for (var i = 0; i < a.length; i++)
        s += a[i] * k;
    if ($vm.llintTrue()) saw.llint++;
    if ($vm.baselineJITTrue()) saw.baseline++;
    if ($vm.dfgTrue()) saw.dfg++;
    if ($vm.ftlTrue()) saw.ftl++;
    return s;
}
noInline(hot);
var arr = [];
for (var i = 0; i < 200; i++) arr.push(i);
var total = 0;
for (var n = 0; n < 200000; n++)
    total += hot(arr, 2);
check("tier loop result", total, 200000 * 2 * (199 * 200 / 2));
check("ran in LLInt", saw.llint, function (v) { return v > 0; });
check("ran in Baseline JIT", saw.baseline, function (v) { return v > 0; });
check("ran in DFG JIT", saw.dfg, function (v) { return v > 0; });
check("ran in FTL JIT", saw.ftl, function (v) { return v > 0; });
check("numberOfDFGCompiles(hot) (DFG+FTL compiles)", numberOfDFGCompiles(hot), function (v) { return v >= 2; });

// 3. Promise jobs and async functions
var order = [];
Promise.resolve(42).then(function (v) { order.push("then:" + v); });
(async function () {
    order.push("async-start");
    var v = await new Promise(function (r) { r(7); });
    order.push("await:" + v);
    for await (var x of (async function* () { yield 1; yield 2; })()) order.push("gen:" + x);
})();
order.push("sync-end");
drainMicrotasks();
check("promise job order", order.join(","), "async-start,sync-end,then:42,await:7,gen:1,gen:2");

// 4. WebAssembly: module with a loop and a memory; out-of-bounds load must trap (signal handler or bounds check)
var wasmBytes = new Uint8Array([0,97,115,109,1,0,0,0,1,6,1,96,1,127,1,127,3,3,2,0,0,5,3,1,0,1,7,20,3,3,109,101,109,2,0,3,115,117,109,0,0,4,108,111,97,100,0,1,10,45,2,35,1,2,127,2,64,3,64,32,1,32,0,79,13,1,32,2,32,1,106,33,2,32,1,65,1,106,33,1,12,0,11,11,32,2,11,7,0,32,0,40,2,0,11]);
var wasmModule = new WebAssembly.Module(wasmBytes);
var wasmInstance = new WebAssembly.Instance(wasmModule);
check("wasm sum(1000)", wasmInstance.exports.sum(1000), 499500);
var wsum = 0;
for (var n = 0; n < 20000; n++) wsum = (wsum + wasmInstance.exports.sum(1000)) | 0;   // hot: BBQ then OMG
check("wasm hot loop", wsum, (499500 * 20000) | 0);
new Uint32Array(wasmInstance.exports.mem.buffer)[4] = 0xdecaf;
check("wasm memory load", wasmInstance.exports.load(16), 0xdecaf);
var trapped = "no trap";
try { wasmInstance.exports.load(65536 * 4); } catch (e) { trapped = e.constructor.name + ": " + e.message; }
check("wasm out-of-bounds trap", trapped, function (v) { return /RuntimeError/.test(v) && /[Oo]ut of bounds/.test(v); });

// 5. ICU (statically linked data)
check("Intl.NumberFormat de-DE", new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(1234567.891), "1.234.567,89\u00a0\u20ac");
check("Intl.DateTimeFormat ja-JP UTC", new Intl.DateTimeFormat("ja-JP", { dateStyle: "full", timeZone: "UTC" }).format(new Date(0)), "1970\u5e741\u67081\u65e5\u6728\u66dc\u65e5");
check("toLocaleUpperCase tr", "i".toLocaleUpperCase("tr"), "\u0130");
check("Intl.Collator sv", ["z", "\u00e4", "a"].sort(new Intl.Collator("sv").compare).join(""), "az\u00e4");
check("String.normalize NFD length", "\u00e9".normalize("NFD").length, 2);

// 6. RegExp (Yarr JIT)
var re = /(\d{4})-(\d{2})-(\d{2})/g, text = "", count = 0;
for (var i = 0; i < 2000; i++) text += "x 2024-0" + (i % 9 + 1) + "-1" + (i % 10) + " y ";
for (var r = 0; r < 50; r++) { re.lastIndex = 0; while (re.exec(text)) count++; }
check("regexp matches", count, 2000 * 50);

// 7. GC: allocate, collect, keep a live structure intact
var live = [];
for (var i = 0; i < 100000; i++) { var o = { i: i, s: "s" + i, a: [i, i + 1] }; if (i % 100 == 0) live.push(o); }
fullGC(); edenGC(); gc();
check("GC keeps live objects", live.length + ":" + live[999].s + ":" + live[500].a[1], "1000:s99900:50001");

// 8. stack overflow is a RangeError, not a crash (stack bounds of the main thread)
function recurse(n) { return 1 + recurse(n + 1); }
var so = "none";
try { recurse(0); } catch (e) { so = e.constructor.name; }
check("stack overflow", so, "RangeError");

// 9. a second thread with its own VM: $.agent (threads, thread locals, locks, Atomics.wait/notify)
if (typeof $ !== "undefined" && $.agent) {
    var sab = new SharedArrayBuffer(16);
    var ia = new Int32Array(sab);
    $.agent.start("$.agent.receiveBroadcast(function (sab) { var ia = new Int32Array(sab); var s = 0; for (var i = 0; i < 1e6; i++) s += i % 7; Atomics.store(ia, 1, s); Atomics.store(ia, 0, 1); Atomics.notify(ia, 0); $.agent.report('agent done ' + s); $.agent.leaving(); });");
    $.agent.broadcast(sab);
    var rep = waitForReport();
    check("agent thread report", rep, "agent done 2999997");
    check("shared memory from agent", Atomics.load(ia, 0) + ":" + Atomics.load(ia, 1), "1:2999997");
} else
    check("agent available", false, true);

// 10. Date and Math (libm comes from musl in the portable build)
check("Date UTC", new Date(Date.UTC(2024, 1, 29, 12, 0, 0)).toISOString(), "2024-02-29T12:00:00.000Z");
// libm results: exact digits are printed (they may differ in the last bit between C libraries); the check allows 2 ulp.
var libmGot = [Math.pow(2, 0.5), Math.sin(1), Math.exp(1), Math.log(10), Math.atan2(1, 2), Math.cbrt(2), Math.tanh(0.5)];
var libmWant = [1.4142135623730951, 0.8414709848078965, 2.718281828459045, 2.302585092994046, 0.4636476090008061, 1.2599210498948732, 0.46211715726000974];
check("libm values (within 2 ulp) " + libmGot.join(","), libmGot.every(function (v, i) { return Math.abs(v - libmWant[i]) <= 2 * 2.220446049250313e-16 * Math.abs(libmWant[i]); }), true);
print("libm exact: " + libmGot.map(function (v, i) { return v === libmWant[i] ? "=" : "DIFF(" + v + " vs correctly rounded " + libmWant[i] + ")"; }).join(" "));
check("parseFloat/toFixed/toString(2)", [parseFloat("1.7976931348623157e308"), (0.1 + 0.2).toFixed(20), (255.5).toString(2)].join(","), "1.7976931348623157e+308,0.30000000000000004441,11111111.1");

print("SMOKE " + passed + " passed, " + failed + " failed");
