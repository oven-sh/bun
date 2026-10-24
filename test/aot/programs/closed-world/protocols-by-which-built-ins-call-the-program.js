// The protocols by which built-in functions call functions of the program, with the arguments they pass.
const log = (...a) => console.log(a.map(String).join(" "));
class M1 extends Map { set(k, v) { log(1, "set", k, v); return super.set(k, v * 2); } } log(1, new M1([[1, 2]]).get(1));
class S2 extends Set { add(v) { log(2, "add", v); return super.add(v + 1); } } log(2, [...new S2([1, 2])].join());
class P3 extends Promise { static get [Symbol.species]() { log(3, "species"); return Promise; } } log(3, new P3(r => r(1)).then(x => x) instanceof P3);
class A4 extends Array { static get [Symbol.species]() { return Array; } } log(4, new A4(1, 2, 3).map(x => x) instanceof A4, A4.from([1]) instanceof A4);
const t5 = { then(res) { log(5, "then", typeof res); res(42); } }; (async () => log(5, await t5))();
const o6 = { toJSON(k) { return "json:" + k; } }; log(6, JSON.stringify({ a: o6, b: [o6] }));
const o7 = { [Symbol.toPrimitive](h) { return h === "number" ? 7 : h; } }; log(7, +o7, `${o7}`, o7 + "", o7 * 2, [1][o7], new Date(o7).getTime() !== 0);
const o8 = { valueOf() { return 8; }, toString() { return "eight"; } }; log(8, o8 + 1, `${o8}`, o8 > 7, [o8].join(), "x".repeat(o8).length, Math.max(o8, 1));
const r9 = /a/; r9.exec = function (s) { log(9, "exec", s); return null; }; log(9, r9.test("aaa"), "aaa".replace(r9, "b"));
const d10 = new Date(0); d10.toISOString = () => "iso!"; log(10, JSON.stringify(d10), d10.toJSON());
const a11 = [1, 2]; a11.join = () => "joined"; log(11, String(a11), `${a11}`, a11 + "");
const e12 = new Error("m"); e12.name = { toString() { return "N"; } }; log(12, String(e12)); class E12 extends Error { get message() { return "got"; } get name() { return "E"; } } log(12, String(new E12("x")));
const al13 = { get length() { log(13, "length"); return 2; }, 0: "a", get 1() { log(13, "one"); return "b"; } }; log(13, Array.from(al13).join(), Array.prototype.map.call(al13, x => x + x).join());
const it14 = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i > 1, value: i++ }; }, return() { log(14, "return"); return {}; } }; } }; const [x14] = it14; log(14, x14, [...it14].join(), Math.max(...it14), new Set(it14).size);
const desc15 = { get value() { log(15, "value"); return 5; }, get enumerable() { log(15, "enum"); return true; } }; log(15, Object.defineProperty({}, "x", desc15).x);
const c16 = { [Symbol.isConcatSpreadable]: true, length: 2, 0: "x", 1: "y" }; log(16, [1].concat(c16).join());
const m17 = { [Symbol.match](s) { return ["m:" + s]; }, [Symbol.replace](s, r) { return "r:" + s + r; }, [Symbol.split](s) { return ["s", s]; }, [Symbol.search](s) { return 17; } }; log(17, "q".match(m17), "q".replace(m17, "z"), "q".split(m17), "q".search(m17));
class H18 { static [Symbol.hasInstance](v) { return v === 18; } } log(18, 18 instanceof H18, {} instanceof H18);
const p19 = new Proxy({}, { get(t, k) { return typeof k === "string" ? "got " + k : undefined; }, has() { return true; }, ownKeys() { return ["a"]; }, getOwnPropertyDescriptor() { return { value: 1, enumerable: true, configurable: true }; } }); log(19, p19.zz, "q" in p19, Object.keys(p19).join(), JSON.stringify(p19), { ...p19 }.a);
function f20(a, b, c) { return [typeof a, typeof b, typeof c, arguments.length].join(); } log(20, f20(1, 2, 3), [5].map(f20), ["x"].reduce(f20, 0), "a".replace(/a/, f20), [2, 1].sort(f20).join(), Reflect.apply(f20, null, []), f20.call(), f20.apply(null, { length: 1 }), f20.bind(null, "s")(), new Function("f", "return f(null)")(f20));
function g21(x) { return x * 2; } log(21, g21(2), [1, "3", undefined, null, {}, 2n === 2n].map(g21).join());
function h22(o) { return o.v; } log(22, h22({ v: 1 }), [{ v: "s" }, { w: 1 }, [], "str", 5].map(h22).join());
class T23 { constructor() { this.v = 1; } get() { return this.v; } } const get23 = T23.prototype.get; log(23, new T23().get(), get23.call({ v: "other" }), [{ v: 3 }].map(function () { return get23.call(this); }, { v: "thisArg" }).join()); try { get23(); } catch (e) { log(23, e.constructor.name); }
const o24 = { get [Symbol.toStringTag]() { return "Tag"; } }; log(24, Object.prototype.toString.call(o24), String(o24));
const l25 = { toLocaleString() { return "loc"; } }; log(25, [l25, 1].toLocaleString());
const raw26 = { get raw() { return ["a", "b"]; } }; log(26, String.raw(raw26, 1));
const opt27 = { get cause() { log(27, "cause"); return 1; } }; log(27, new Error("x", opt27).cause);
class PR28 { static resolve(v) { log(28, "resolve", v); return Promise.resolve(v); } constructor(f) { return new Promise(f); } } try { Promise.all.call(PR28, [1]).then(v => log(28, v)); } catch (e) { log(28, e.constructor.name); }
const fin29 = { [Symbol.dispose]() { log(29, "disposed"); } }; { using x = fin29; log(29, "in"); }
const w30 = { f() { return this === w30; } }; log(30, w30.f(), (0, w30.f)(), [w30.f][0]() === false, setTimeout(w30.f, 0) !== 0);
function k31() { return this; } log(31, typeof k31(), typeof k31.call(1), k31.call(null) === globalThis, [1].map(k31)[0] === globalThis);
function s32() { "use strict"; return this; } log(32, s32(), typeof s32.call(1), [1].map(s32)[0], [1].map(s32, "t")[0]);
const cmp33 = { valueOf() { arr33.length = 0; return 0; } }; const arr33 = [1, 2, 3, 4]; log(33, arr33.fill(9, cmp33).join(), arr33.length);
const arr34 = [1, 2, 3, 4, 5]; log(34, arr34.map((x, i) => { if (i === 0) arr34.length = 2; return x; }).join(), arr34.length);
const arr35 = [1.5, 2.5, 3.5]; log(35, arr35.map((x, i) => { if (i === 0) arr35[2] = "s"; return typeof x; }).join());
const arr36 = [1, 2, 3]; let sum36 = 0; for (const x of arr36) { if (x === 1) { arr36.push("four"); arr36[1] = { o: 1 }; } sum36 += x; } log(36, sum36);
