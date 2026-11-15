// NaNs with any bits are read beside accesses that lie outside their view: what is read is kept as a value where the block goes on.
var heap = new ArrayBuffer(256), bits = new Uint32Array(heap), doubles = new Float64Array(heap), singles = new Float32Array(heap), words = new Int32Array(heap), kept = [], out = [];
function pair(p, q) { var x = doubles[p], y = words[q]; kept.push(x); return [x, y]; }
function single(p, q) { var x = singles[p], y = words[q], z = { x: x }; return [z.x, y, x]; }
function sum(p, q) { var x = doubles[p], y = singles[p], z = words[q]; return [x + y, x, y, z]; }
function store(p, q) { var x = doubles[p]; words[q] = 5; kept[0] = x; return typeof x + x; }
function loop(p, q) { var x, last; for (var i = 0; i < 8; i++) { x = doubles[p]; last = words[q]; words[16 + i] = i; if (last == undefined) kept.push(x); q = (q + 9) | 0; } return [x, last, kept.length]; }
function unsigned(v) { if (v >= 0) return v; return v + 4294967296; }
function compared(p, q) { var x = doubles[p], y = words[q]; if (unsigned(x) < unsigned(y)) return [x, "less"]; return [x, y]; }
function show(list) { return list.map(function (x) { return Object.is(x, -0) ? "-0" : String(x); }).join(); }
var patterns = [0x7ff00001, 0x7ff80000, 0x7fffffff, 0xfff00000, 0xfff80000, 0xfffe0000, 0xfffe0001, 0xffff0000, 0xffffffff, 0xfff90007, 0x3ff00000, 0x80000000, 0x7f800001, 0xffc00001];
for (var high of patterns)
    for (var low of [0, 1, 7, 10, 0xffffffff]) {
        for (var i = 0; i < 16; i += 2) { bits[i] = low; bits[i + 1] = high; }
        for (var q of [20, 64, -1, 1 << 29])
            for (var f of [pair, single, sum, store, loop, compared]) {
                kept = [];
                var answer = f(1, q);
                out.push(f.name + show([].concat(answer)) + show(kept));
            }
    }
console.log(out.length, out.join("\n"));
