const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
const kinds = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array];
if (typeof Float16Array === "function") kinds.push(Float16Array);
const values = [0, 1, -1, 127, 128, 255, 256, 300, -300, 65535, 65536, 2147483647, -2147483648, 4294967295, 1.5, -1.5, 0.1, 1e300, -1e-300, NaN, Infinity, -Infinity, -0, "7", "x", null, undefined, true, [5], { valueOf() { return 9; } }, 5n, -5n];
const store = new Function("a", "i", "v", hidden("a[i] = v; return a[i];"));
const storeConstant = new Function("a", "i", hidden("a[i] = 1.5; a[i + 1] = 300; a[i + 2] = -1; return a[i] + ':' + a[i + 1] + ':' + a[i + 2];"));
const fill = (0, eval)(hidden("(a, v) => { for (let i = 0; i < a.length; i++) a[i] = v; return a.join(); }"));
const strict = new Function("a", "i", "v", hidden("'use strict'; a[i] = v; return a[i];"));
const text = v => typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : String(v);
const attempt = f => { try { return text(f()); } catch (e) { return "!" + e.constructor.name; } };
for (let turn = 0; turn < 3; turn++) {
    for (const Kind of kinds) {
        const l = [];
        for (const v of values) {
            const a = new Kind(4);
            for (const i of [0, 3, 4, -1, 1.5, "2", "x", 4294967295]) l.push(attempt(() => store(a, i, v)), attempt(() => strict(a, i, v)));
            l.push(attempt(() => a.join()));
        }
        l.push(attempt(() => storeConstant(new Kind(4), 0)), attempt(() => storeConstant(new Kind(4), 3)));
        for (const v of [3, 2.5, -7]) l.push(attempt(() => fill(new Kind(5), v)));
        console.log(Kind.name, l.join(" "));
    }
    // Shorter, longer and gone while the text goes on.
    const buffer = new ArrayBuffer(8, { maxByteLength: 32 }), tracking = new Uint8Array(buffer), fixed = new Uint8Array(buffer, 2, 4), doubles = new Float64Array(buffer);
    const l = [];
    for (const size of [8, 16, 32, 4, 0, 24]) {
        buffer.resize(size);
        for (const a of [tracking, fixed, doubles]) for (const i of [0, 1, 3, 7, 15]) l.push(attempt(() => store(a, i, size + i)));
    }
    const other = new ArrayBuffer(16), view = new Int32Array(other), floats = new Float32Array(other);
    l.push(attempt(() => store(view, 1, 70000)), attempt(() => store(floats, 1, 2.75)), attempt(() => store(view, 1, 1.5)));
    const moved = other.transfer();
    l.push(attempt(() => store(view, 1, 5)), attempt(() => store(floats, 0, 5.5)), attempt(() => strict(view, 0, 5)), new Int32Array(moved).join());
    const shared = new Int16Array(new SharedArrayBuffer(8));
    l.push(attempt(() => store(shared, 2, 40000)), attempt(() => store(shared, 9, 1)));
    class Heir extends Float64Array { get extra() { return this[0]; } }
    const heir = new Heir(3);
    l.push(attempt(() => store(heir, 0, 4.25)), heir.extra, attempt(() => store(heir, 1, turn)), heir.join());
    const below = Object.create(new Uint8Array(2));
    l.push(attempt(() => store(below, 0, 6)), Object.keys(below).join());
    const proxied = new Proxy(new Uint8Array(2), {});
    l.push(attempt(() => store(proxied, 0, 6)));
    const v = { valueOf() { big.buffer.transfer(); return 3; } }, big = new Float64Array(2);
    l.push(attempt(() => store(big, 0, v)), big.length);
    console.log(l.join(" "));
}
// A loop that is warm before the kind changes.
const sum = new Function("a", "n", hidden("let s = 0; for (let i = 0; i < n; i++) { a[i & 3] = i * 1.5; s += a[i & 3]; } return s;"));
for (const Kind of kinds.filter(k => !k.name.startsWith("Big"))) console.log(Kind.name, sum(new Kind(4), 5000), sum(new Kind(4), 10), sum(new Array(4), 10));
console.log(sum([0, 0, 0, 0], 100), sum({}, 100), sum(new Float64Array(0), 5));
