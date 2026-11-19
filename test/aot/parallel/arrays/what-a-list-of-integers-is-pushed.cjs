// A list of integers that nobody proves is pushed every kind of value and then summed by a loop over integers, sorted, searched, and looked at behind collections.
"use strict";
const out = [], hide = v => [v][JSON.parse("0")], gc = () => { if (typeof Bun !== "undefined") Bun.gc(true); };
const pushes = { one: (a, v) => a.push(v), two: (a, v) => a.push(v, v), mixed: (a, v) => a.push(7, v), front: (a, v) => a.push(v, 7), three: (a, v) => a.push(1, v, 2), four: (a, v) => a.push(1, 2, 3, v) };
function sum(a) { let s = 0; for (let i = 0; i < a.length; i++) s = (s + a[i]) | 0; return s; }
function total(a) { let s = 0; for (const x of a) s += x; return s; }
const values = () => [5, -1, 2147483647, 1.5, -0, 2 ** 31, NaN, Infinity, "8", true, null, undefined, { valueOf() { return 4; }, v: 9 }, [3], 2n];
for (let r = 0; r < 60; r++) { out.length = 0; for (const [n, push] of Object.entries(pushes)) for (const v of values()) { const a = JSON.parse("[1,2,3,4,5,6,7,8]"); a.length = 3; for (let k = 0; k < 3; k++) out.push(hide(push)(a, v)); try { out.push(sum(a), String(total(a))); } catch (e) { out.push(e.name); } out.push(a.indexOf(v), a.includes(v), a.length, String(a.slice(3, 6).map(x => typeof x))); a.length = 4; hide(push)(a, 6); out.push(sum(a.filter(x => typeof x === "number"))); } }
const kept = []; for (let i = 0; i < 64; i++) kept.push(JSON.parse("[1,2,3,4]")); gc(); gc();
for (const push of Object.values(pushes)) for (const a of kept) { a.length = 2; hide(push)(a, { v: a.length, pad: [1, 2, 3] }); }
gc(); let junk = []; for (let i = 0; i < 20000; i++) junk.push({ v: "x" + i, pad: [i] }); junk = null; gc();
out.push(kept.map(a => a.map(x => (x && x.v !== undefined ? "o" + x.v + x.pad.length : x)).join("")).join("/"));
console.log(out.join("|"));
