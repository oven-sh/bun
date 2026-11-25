// Numbers of every kind out of sums, lists, views and fields, seen by every user of a boxed number.
const any: any = (globalThis as any)["Obj" + "ect"];
const bases = [0, -0, 1, -1, 2, 3, 7, 10, 21, 22, 0.5, -0.5, 0.25, 1.25, 100.5, 1 / 3, -1 / 3, 0.1, 1e-7, 1e-320, 5e-324, 1e300, -1e300, NaN, Infinity, -Infinity, 2 ** 21, 2 ** 22, 2 ** 22 + 1, 2 ** 30, 2 ** 31 - 1, 2 ** 31, 2 ** 31 + 1, -(2 ** 31), -(2 ** 31) - 1, -(2 ** 31) + 1, 2 ** 32 - 1, 2 ** 32, 2 ** 33 + 1, 2 ** 52, 2 ** 53 - 1, 2 ** 31 - 0.5, 4194303.5, 1048575.75, 1 + 2 ** -31, 1 + 2 ** -30, 3 + 2 ** -29, 2 ** 30 + 2 ** -22, 1.5 + 2 ** -52, 123456789.125, -123456789];
let lines = 0, sum = 0;
function note(s: string) { ++lines; for (let i = 0; i < s.length; ++i) sum = (sum * 31 + s.charCodeAt(i)) | 0; }
function show(v: any): string { return any.is(v, -0) ? "-0" : String(v); }
const table: any = ["a", "b", "c", "d", , "f", "g", "h"], words: any = { 0: "zero", 3: "three", 0.5: "half", "-1": "minus" }, map: any = new Map<any, any>([[0, "m0"], [1, "m1"], [0.5, "mh"], [NaN, "mn"], [2147483648, "mb"], [7, "m7"]]), set: any = new Set<any>([3, -1, 0.25, 2147483647]);
function users(v: any): string {
    let r = show(v) + " " + typeof v + " " + table[v] + " " + words[v] + " " + map.get(v) + " " + set.has(v) + " " + (v | 0) + " " + (v >>> 1) + " " + (v === 3) + (v == 0) + (v < 7) + (v !== v) + " " + Number.isInteger(v) + any.is(v, 1) + " " + JSON.stringify([v]) + " " + [0, 1, 2, 0.5].indexOf(v) + [1, 3, NaN].includes(v);
    switch (v) { case 0: r += "c0"; break; case 1: r += "c1"; break; case 3: r += "c3"; break; case 7: r += "c7"; break; case 0.5: r += "ch"; break; case 2147483648: r += "cb"; break; default: r += "cd"; }
    const list: any = [1, 2, 3]; list[v] = "w"; r += any.keys(list).join(); return r + show(-v) + show(v + 1) + show(v * 2) + show(v - 0.5) + show(v % 3) + show(v ** 2) + show(v / 4);
}
function plus(a: any, b: any) { return a + b; } function minus(a: any, b: any) { return a - b; } function times(a: any, b: any) { return a * b; } function over(a: any, b: any) { return a / b; } function rest(a: any, b: any) { return a % b; } function power(a: any, b: any) { return a ** b; }
function at(list: any, i: any) { return list[i]; }
function last(list: any) { return list.at(-1); }
function popped(list: any) { return list.pop(); }
class Pair { constructor(public a: number, public b: number) { } }
class Late { a: any; b: any; set(a: any, b: any) { this.a = a; this.b = b; return this; } }
function fields(o: any, k: any) { return k ? o.a : o.b; }
const doubles: any = bases.filter(x => x === x), holes: any = [0.5, , 2.5, , 1], f64: any = new Float64Array(bases), f32: any = new Float32Array(bases), u32: any = new Uint32Array(bases.map(x => x >>> 0)), i32: any = new Int32Array(bases.map(x => x | 0)), mixed: any = [...bases, "x"];
const bitsView = new DataView(new ArrayBuffer(8));
function fromBits(high: any, low: any) { bitsView.setUint32(0, high); bitsView.setUint32(4, low); return bitsView.getFloat64(0); }
for (let round = 0; round < 2; ++round) {
    for (const x of bases) {
        note(users(x));
        for (const y of bases) { note(show(plus(x, y)) + show(minus(x, y)) + show(times(x, y)) + show(over(x, y)) + show(rest(x, y)) + show(power(x, y))); if (round) note(users(plus(x, y)) + users(over(x, y))); }
        note(users(fields(new Pair(x, 0.5), 1)) + users(fields(new Pair(1, x), 0)) + users(fields(new Late().set(x, 1.5), 1)) + users(fields({ a: x, b: -x }, 0)));
        const grow: any = [0.5]; grow.push(x, 1.5, x); note(users(at(grow, 1)) + users(last(grow)) + users(popped(grow)) + grow.length);
    }
    for (const list of [doubles, holes, f64, f32, u32, i32, mixed]) { for (let i = -1; i <= list.length; ++i) note(users(at(list, i))); let s: any = 0; for (const v of list) s = plus(s, v); note(show(s)); note(list.map((v: any) => show(v)).join()); note([...list].sort((a: any, b: any) => minus(a, b) || 0).map(show).join()); }
    for (const high of [0x7ff80000, 0x7ff00000, 0xfff80000, 0xffff0000, 0xfffe0000, 0xffffffff, 0x3ff00000, 0x41dfffff, 0x00000000, 0x80000000]) for (const low of [0, 1, 0x3fffff, 0x400000, 0x200000, 0xffffffff, 0xffc00000, 0x80000000]) { const v: any = fromBits(high, low); note(users(v)); f64[0] = v; note(users(at(f64, 0))); const o = new Pair(v, v); note(users(fields(o, 1)) + users(plus(v, 0)) + users(times(v, 1))); const l: any = [0.5, 1.5]; l[1] = v; note(users(at(l, 1))); }
}
console.log(lines, sum);
