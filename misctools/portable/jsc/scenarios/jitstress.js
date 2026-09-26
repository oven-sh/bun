// Scenario 11: the JIT compiles a lot, in every tier, and what it compiles needs many
// registers at once. Made for the question "does code that the JIT emits write a register
// that belongs to the platform" (x18 on arm64): the allocators of the optimizing tiers hand
// out every register that they are allowed to when enough values are alive at the same time.
//
// JavaScript: functions are generated from a few shapes (integers that are all alive in
// a loop, doubles, properties of objects of several shapes, typed arrays, strings, calls
// with many arguments and with spread, tail calls, exceptions through compiled frames,
// closures, switches). Every function says in which tier it found itself.
// WebAssembly: a module is generated, its functions have many locals of i32, i64 and f64
// that are alive in a loop, one has 12 parameters, one calls through the table. Every
// function writes the tier that it runs in into the memory.
// Integers, and doubles with +, -, *, / and sqrt only: the checksums are the same everywhere.
//
// Run: jsc --useDollarVM=1 --jitPolicyScale=0.05 --thresholdForOMGOptimizeAfterWarmUp=2000
//          --thresholdForOMGOptimizeSoon=100 jitstress.js [rounds]
var rounds = typeof arguments !== "undefined" && arguments.length ? arguments[0] | 0 : 1;
var LLINT = 1, BASELINE = 2, DFG = 4, FTL = 8;
var seen = [];
var functions = [];
var input = new Int32Array(64);
for (var i = 0; i < input.length; i++)
    input[i] = Math.imul(i + 1, 0x9e3779b1 | 0) >> 7;
var doubles = new Float64Array(64);
for (var i = 0; i < doubles.length; i++)
    doubles[i] = (i * 37 % 101) / 8 + 0.125;

var tier = "seen[K] |= $vm.ftlTrue() ? 8 : $vm.dfgTrue() ? 4 : $vm.baselineJITTrue() ? 2 : $vm.llintTrue() ? 1 : 0;";
function define(body, helpers) {
    var k = functions.length;
    seen.push(0);
    var f = eval("(function () { " + (helpers || "") + " return function f" + k + "(a, d, n) { " + body.replace(/K\b/g, String(k)) + " }; })()");
    noInline(f);
    functions.push(f);
}

// Integers that are alive together.
for (var count of [3, 6, 9, 12, 14, 16, 18, 20, 22, 24, 26, 28]) {
    var names = [];
    for (var v = 0; v < count; v++)
        names.push("v" + v);
    var body = "var " + names.map(function (name, v) { return name + " = " + (v * 7 + 1); }).join(", ") + ";";
    body += "for (var i = 0; i < n; i++) {";
    for (var v = 0; v < count; v++)
        body += names[v] + " = (Math.imul(" + names[v] + ", " + (2 * v + 3) + ") + " + names[(v + 1) % count] + " ^ a[(i + " + v + ") & 63]) | 0;";
    body += "}" + tier + "return (" + names.join(" ^ ") + ") | 0;";
    define(body);
}
// The same with a call in the loop: what is alive over a call has to be in registers that a callee keeps, or on the stack.
for (var count of [8, 16, 24]) {
    var names = [];
    for (var v = 0; v < count; v++)
        names.push("v" + v);
    var body = "var " + names.map(function (name, v) { return name + " = " + (v * 5 + 2); }).join(", ") + ";";
    body += "for (var i = 0; i < n; i++) {";
    for (var v = 0; v < count; v++)
        body += names[v] + " = (" + names[v] + " + helper(" + names[(v + 3) % count] + ", a[(i * " + (v + 1) + ") & 63])) | 0;";
    body += "}" + tier + "return (" + names.join(" + ") + ") | 0;";
    define(body, "function helper(x, y) { return (Math.imul(x, 31) ^ y) | 0; } noInline(helper);");
}
// Doubles that are alive together.
for (var count of [4, 8, 12, 16, 20, 24, 28]) {
    var names = [];
    for (var v = 0; v < count; v++)
        names.push("x" + v);
    var body = "var " + names.map(function (name, v) { return name + " = " + (v + 0.5); }).join(", ") + ";";
    body += "for (var i = 0; i < n; i++) {";
    for (var v = 0; v < count; v++)
        body += names[v] + " = " + names[v] + " * 0.5 + " + names[(v + 1) % count] + " * 0.25 + Math.sqrt(d[(i + " + v + ") & 63]) / " + (v + 2) + ";";
    body += "}" + tier + "var s = 0; " + names.map(function (name) { return "s = (Math.imul(s, 33) + (" + name + " * 4096 | 0)) | 0;"; }).join(" ") + " return s;";
    define(body);
}
// Integers and doubles together, with conversions.
for (var count of [6, 12, 18]) {
    var body = "var s = 0, t = 0.5;";
    for (var v = 0; v < count; v++)
        body += "var i" + v + " = " + (v + 1) + ", x" + v + " = " + (v + 0.25) + ";";
    body += "for (var i = 0; i < n; i++) {";
    for (var v = 0; v < count; v++)
        body += "i" + v + " = (i" + v + " + (x" + ((v + 1) % count) + " | 0) + a[(i + " + v + ") & 63]) | 0; x" + v + " = (x" + v + " + i" + ((v + 2) % count) + " % 1000) / 2;";
    body += "}" + tier;
    for (var v = 0; v < count; v++)
        body += "s = (Math.imul(s, 31) + i" + v + " + (x" + v + " * 64 | 0)) | 0;";
    body += "return s;";
    define(body);
}
// Properties of objects with several shapes, and one with a getter.
for (var shapes of [1, 2, 4, 8]) {
    var make = "var objects = []; for (var s = 0; s < " + shapes + "; s++) { var o = {}; for (var p = 0; p <= s; p++) o['p' + p] = p + 1; o.x = s + 1; o.y = s * 3; objects.push(o); }" +
        "objects.push({ get x() { return 5; }, y: 7 });";
    define("var s = 0; for (var i = 0; i < n; i++) { var o = objects[i % objects.length]; s = (s + o.x * 3 + o.y + a[i & 63]) | 0; o.y = (o.y + 1) & 1023; }" + tier + "return s;", make);
}
// Typed arrays and arrays with holes.
define("var t = new Uint8Array(256), u = new Float32Array(64), s = 0; for (var i = 0; i < n; i++) { t[i & 255] = a[i & 63]; u[i & 63] = t[(i * 7) & 255] / 4; s = (s + t[(i * 3) & 255] + (u[(i * 5) & 63] * 4 | 0)) | 0; }" + tier + "return s;");
define("var s = 0; holes[(n * 7) % 40] = n; for (var i = 0; i < n; i++) { var v = holes[i % 48]; s = (s + (v === undefined ? 3 : v) + a[i & 63]) | 0; }" + tier + "return s;", "var holes = [1, 2, , 4, , 6]; holes[47] = 9;");
// Strings.
define("var s = 0, text = ''; for (var i = 0; i < n; i++) { text += String.fromCharCode(65 + (a[i & 63] & 15)); if (text.length > 40) { s = (s + text.charCodeAt(i % 40) + text.indexOf('C') + text.length) | 0; text = text.slice(20); } }" + tier + "return (s + text.length) | 0;");
define("var s = 0; for (var i = 0; i < n; i++) { var key = keys[a[i & 63] & 7]; s = (s + table[key] + key.length) | 0; }" + tier + "return s;", "var keys = ['a', 'bb', 'ccc', 'dddd', 'e5', 'f66', 'g777', 'h']; var table = {}; keys.forEach(function (k, i) { table[k] = i * 11; });");
// Calls: many arguments, spread, apply, targets that change.
define("var s = 0; for (var i = 0; i < n; i++) s = (s + many(i, a[i & 63], 3, s, 5, i ^ 6, 7, s >> 3, 9, 10, i + 11, 12, 13, a[(i + 1) & 63])) | 0;" + tier + "return s;",
    "function many(p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13) { return (p0 + 2 * p1 + 3 * p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9 + p10 + p11 + 13 * p12 + p13) | 0; } noInline(many);");
define("var s = 0; for (var i = 0; i < n; i++) { var list = [i, a[i & 63], s & 255]; s = (s + three(...list) + three.apply(null, list) + Math.max(...list)) | 0; }" + tier + "return s;",
    "function three(x, y, z) { return (x ^ Math.imul(y, 5) ^ z) | 0; } noInline(three);");
define("var s = 0; for (var i = 0; i < n; i++) s = (s + targets[a[i & 63] & 3](i, s)) | 0;" + tier + "return s;",
    "var targets = [function (x, y) { return x + y; }, function (x, y) { return x ^ y; }, function (x, y) { return Math.imul(x, 3) - y; }, function (x) { return x | 1; }]; targets.forEach(noInline);");
define("'use strict'; var s = 0; for (var i = 0; i < n; i++) s = (s + count(a[i & 63] & 31, i)) | 0;" + tier + "return s;",
    "function count(k, acc) { 'use strict'; if (k <= 0) return acc | 0; return count(k - 1, (acc + k) | 0); } noInline(count);");
// Exceptions through compiled frames.
define("var s = 0; for (var i = 0; i < n; i++) { try { s = (s + risky(a[i & 63], i)) | 0; } catch (e) { s = (s + e.code) | 0; } finally { s = (s ^ 1) | 0; } }" + tier + "return s;",
    "function risky(v, i) { if ((v & 7) == 3) throw { code: i & 15 }; return v >> 2; } noInline(risky);");
// Closures and objects that do not leave the function.
define("var s = 0; for (var i = 0; i < n; i++) { var point = { x: i, y: a[i & 63], z: s & 7 }; var add = function (q) { return (point.x + point.y * q + point.z) | 0; }; s = (s + add(3) + add(i & 3)) | 0; }" + tier + "return s;");
// A switch with many cases.
(function () {
    var body = "var s = 0; for (var i = 0; i < n; i++) { switch (a[i & 63] & 31) {";
    for (var c = 0; c < 32; c++)
        body += "case " + c + ": s = (s " + ["+", "^", "-"][c % 3] + " " + (c * 17 + 1) + " + i) | 0; break;";
    body += "} }" + tier + "return s;";
    define(body);
})();

var sum = 0;
function runAll(n) {
    for (var k = 0; k < functions.length; k++)
        sum = (Math.imul(sum, 31) + functions[k](input, doubles, n)) | 0;
}
for (var r = 0; r < 40 * rounds; r++)
    runAll(48);
var checksum = sum;
// The compilers run on threads of their own and may come late on a busy machine: run on,
// outside of the checksum, until every function was seen in the highest tier.
var allTiers = function () { return seen.every(function (s) { return (s & FTL) != 0; }); };
for (var r = 0; r < 20000 && !allTiers(); r++)
    runAll(48);
var inTier = function (bit) { return seen.filter(function (s) { return s & bit; }).length; };
print("jitstress js functions " + functions.length + " checksum " + (checksum >>> 0).toString(16));
print("jitstress js seen in baseline " + inTier(BASELINE) + " dfg " + inTier(DFG) + " ftl " + inTier(FTL));

// ---- WebAssembly ----
function uleb(n) {
    var out = [];
    do {
        var b = n & 127;
        n >>>= 7;
        out.push(n ? b | 128 : b);
    } while (n);
    return out;
}
function sleb(n) {
    var out = [];
    for (;;) {
        var b = n & 127;
        n >>= 7;
        if ((n == 0 && !(b & 64)) || (n == -1 && (b & 64))) {
            out.push(b);
            return out;
        }
        out.push(b | 128);
    }
}
function f64(x) {
    var view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, x, true);
    return [0x44].concat(Array.from(new Uint8Array(view.buffer)));
}
var I32 = 0x7f, I64 = 0x7e, F64 = 0x7c;
function section(id, content) { return [id].concat(uleb(content.length), content); }
function vector(items) { return uleb(items.length).concat([].concat.apply([], items)); }
function name(text) { return uleb(text.length).concat(Array.from(text, function (c) { return c.charCodeAt(0); })); }
var get = function (i) { return [0x20].concat(uleb(i)); }, set = function (i) { return [0x21].concat(uleb(i)); };
var i32const = function (n) { return [0x41].concat(sleb(n)); }, i64const = function (n) { return [0x42].concat(sleb(n)); };
// memory[4 * k] |= 1 << tier, where tier is bbq() | omg() << 1: 0 interpreter, 1 BBQ, 3 OMG.
function record(k) {
    return i32const(4 * k).concat(i32const(4 * k), [0x28, 2, 0], i32const(1), [0x10, 0], [0x10, 1], i32const(1), [0x74, 0x72, 0x74, 0x72, 0x36, 2, 0]);
}
// (n) -> i32. Local 1 counts, then come the locals of the three types.
function kernel(k, ni, nl, nd) {
    var first = 2, body = [], all = [];
    for (var j = 0; j < ni; j++) all.push({ index: first + j, type: I32 });
    for (var j = 0; j < nl; j++) all.push({ index: first + ni + j, type: I64 });
    for (var j = 0; j < nd; j++) all.push({ index: first + ni + nl + j, type: F64 });
    all.forEach(function (local, j) {
        body = body.concat(local.type == I32 ? i32const(j * 3 + k + 1) : local.type == I64 ? i64const(j * 5 + k + 2) : f64(j + 0.5), set(local.index));
    });
    var next = function (type, j) {
        var same = all.filter(function (l) { return l.type == type; });
        return same[(same.indexOf(all[j]) + 1) % same.length].index;
    };
    var loop = get(1).concat(get(0), [0x4f, 0x0d, 1]);
    all.forEach(function (local, j) {
        if (local.type == I32) loop = loop.concat(get(local.index), i32const(2 * j + 3), [0x6c], get(next(I32, j)), [0x6a], get(1), [0x73], set(local.index));
        else if (local.type == I64) loop = loop.concat(get(local.index), i64const(2 * j + 5), [0x7e], get(next(I64, j)), [0x7c], get(1), [0xad, 0x7c], set(local.index));
        else loop = loop.concat(get(local.index), f64(0.5), [0xa2], get(next(F64, j)), f64(0.25), [0xa2, 0xa0], get(1), i32const(1023), [0x71, 0xb8, 0xa0], set(local.index));
    });
    loop = loop.concat(get(1), i32const(1), [0x6a], set(1), [0x0c, 0]);
    body = body.concat([0x02, 0x40, 0x03, 0x40], loop, [0x0b, 0x0b], record(k), i32const(0));
    all.forEach(function (local) {
        if (local.type == I32) body = body.concat(get(local.index), [0x73]);
        else if (local.type == I64) body = body.concat(get(local.index), [0xa7, 0x73], get(local.index), i64const(32), [0x88, 0xa7, 0x73]);
        else body = body.concat(get(local.index), [0xbd, 0xa7, 0x73], get(local.index), [0xbd], i64const(32), [0x88, 0xa7, 0x73]);
    });
    var locals = [[1, I32]];
    if (ni) locals.push([ni, I32]);
    if (nl) locals.push([nl, I64]);
    if (nd) locals.push([nd, F64]);
    return vector(locals.map(function (l) { return uleb(l[0]).concat([l[1]]); })).concat(body, [0x0b]);
}
var kernels = [[4, 0, 0], [12, 0, 0], [20, 0, 0], [28, 0, 0], [0, 6, 0], [0, 14, 0], [0, 22, 0], [0, 28, 0], [0, 0, 6], [0, 0, 16], [0, 0, 28],
    [6, 6, 6], [10, 10, 10], [14, 10, 4], [4, 20, 8], [18, 4, 12], [24, 24, 24], [2, 2, 2], [9, 3, 17], [16, 16, 0]];
var imports = 2, many = imports + kernels.length, through = many + 1;
var bodies = kernels.map(function (shape, k) { return kernel(k, shape[0], shape[1], shape[2]); });
// 12 parameters: some arrive on the stack. It calls a kernel.
var manyBody = [0].concat(record(kernels.length), get(0), i32const(15), [0x71, 0x10, imports + 1]);
for (var p = 1; p < 12; p++)
    manyBody = manyBody.concat(get(p), i32const(p + 1), [0x6c, 0x6a]);
bodies.push(manyBody.concat([0x0b]));
// (which, n): a call through the table.
bodies.push([0].concat(record(kernels.length + 1), get(1), get(0), [0x11, 1, 0, 0x0b]));
var module = [0, 97, 115, 109, 1, 0, 0, 0].concat(
    section(1, vector([[0x60, 0, 1, I32], [0x60, 1, I32, 1, I32], [0x60, 12].concat(new Array(12).fill(I32), [1, I32]), [0x60, 2, I32, I32, 1, I32]])),
    section(2, vector([name("env").concat(name("bbq"), [0, 0]), name("env").concat(name("omg"), [0, 0])])),
    section(3, vector(kernels.map(function () { return [1]; }).concat([[2], [3]]))),
    section(4, vector([[0x70, 0, kernels.length]])),
    section(5, vector([[0, 1]])),
    section(7, vector(kernels.map(function (shape, k) { return name("k" + k).concat([0], uleb(imports + k)); }).concat([name("many").concat([0], uleb(many)), name("through").concat([0], uleb(through)), name("mem").concat([2, 0])]))),
    section(9, vector([[0].concat(i32const(0), [0x0b], vector(kernels.map(function (shape, k) { return uleb(imports + k); })))])),
    section(10, vector(bodies.map(function (body) { return uleb(body.length).concat(body); }))));
var instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(module)), { env: { bbq: callerIsBBQOrOMGCompiled, omg: $vm.omgTrue } });
var wasm = instance.exports, tiers = new Uint32Array(wasm.mem.buffer), total = kernels.length + 2;
var wasmSum = 0;
function runWasm(n) {
    for (var k = 0; k < kernels.length; k++)
        wasmSum = (Math.imul(wasmSum, 31) + wasm["k" + k](n)) | 0;
    wasmSum = (Math.imul(wasmSum, 31) + wasm.many(n, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, wasmSum & 255)) | 0;
    wasmSum = (Math.imul(wasmSum, 31) + wasm.through(n % kernels.length, n)) | 0;
}
for (var r = 0; r < 60 * rounds; r++)
    runWasm(40);
var wasmChecksum = wasmSum;
var wasmAll = function () {
    for (var k = 0; k < total; k++)
        if (!(tiers[k] & 8))
            return false;
    return true;
};
for (var r = 0; r < 200000 && !wasmAll(); r++)
    runWasm(40);
var wasmIn = function (bit) {
    var count = 0;
    for (var k = 0; k < total; k++)
        if (tiers[k] & bit)
            count++;
    return count;
};
print("jitstress wasm functions " + total + " checksum " + (wasmChecksum >>> 0).toString(16));
print("jitstress wasm seen in bbq " + wasmIn(2) + " omg " + wasmIn(8));
