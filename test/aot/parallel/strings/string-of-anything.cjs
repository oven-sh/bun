"use strict";
// String and templates of anything: integers small and large, fractions, texts, what runs code and what throws; in loops, outside, by value.
const out = [], hide = v => [v][JSON.parse("0")], log = [];
const values = [0, 1, 9, 10, 255, 256, 257, 4096, -1, -255, -256, 2147483647, -2147483648, 4294967295, 1e15, 0.5, -0, NaN, Infinity, 1e21, "", "a", "a".repeat(300), "\u03b1", null, undefined, true, 10n, Symbol("s"), [], [1, [2]], {}, { toString() { log.push("s"); return "t"; } }, { valueOf() { log.push("v"); return 5; } }, { [Symbol.toPrimitive](h) { log.push(h); return h === "string" ? "p" : 6; } }, { toString() { throw new RangeError("r"); } }, new Date(NaN), new Number(7), Object.create(null)];
const ways = [x => String(x), x => `${x}`, x => "" + x, x => x + "", x => `a${x}b${x}`, x => { let s = ""; for (let i = 0; i < 3; i++) s += x; return s; }, x => { let s = ""; for (let i = 0; i < 3; i++) s += String(x) + i; return s; }, x => ({ [x]: 1 }), x => [x].join(), x => hide(String)(x), x => String.call(null, x), x => String(x, 1), x => `${x}`.length + String(x).length, x => { const m = {}; m[`k${x}`] = x; return Object.keys(m)[0]; }];
for (let r = 0; r < 4; r++) for (const v of values) for (const f of ways) { try { const a = f(hide(v)); out.push(typeof a === "object" ? Reflect.ownKeys(a).map(String).join() : a); } catch (e) { out.push(e.name); } }
for (let i = -300; i < 700; i++) if (String(hide(i)) !== `${hide(i)}` || +String(hide(i)) !== i) out.push("WRONG" + i);
out.push(String(), `${hide(255)}${hide(256)}`, String(hide(7)) === "7");
let h = 7; for (const x of out) { const v = String(x); for (let i = 0; i < v.length; i++) h = (Math.imul(h, 31) + v.charCodeAt(i)) | 0; } console.log(out.length, log.length, h, out.slice(0, 12).join());
