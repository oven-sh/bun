// A loop over pairs takes an element of a view that may lie past its end, or what it was handed, of which nothing is known: zero, what is missing and what is no number are told apart as written.
"use strict";
const show = v => (v === undefined ? "_" : Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "object" && v ? "o" : String(v));
const guarded = (f, ...all) => { try { return show(f(...all)); } catch (error) { return error.constructor.name; } };
function orElse(view, given, n) { let sum = 0; for (let i = 0; i < n; i++) sum += (view[2 * i + 1] || given) - i; return sum; }
function present(view, given, n) { let out = ""; for (let i = 0; i < n; i++) out += show(view[2 * i] ?? given) + show(view[2 * i + 1] === undefined ? given : view[2 * i + 1]) + " "; return out; }
function pulled(pairs, pull, n, given) { for (let i = 0; i < n; i++) { const at = 2 * i, by = pull[i] || given; pairs[at] = pairs[at] / by; pairs[at + 1] += by; } return Array.from(pairs, show).join(); }
function nearest(view, given, n) { let best = given; for (let i = 0; i < n; i++) { const x = view[i * 2]; if (x < best) best = x; } return best; }
function kept(view, given, n) { let last = given, kinds = ""; for (let i = 0; i < n; i++) { last = view[i + 2] || last; kinds += (typeof last)[0]; } return kinds + show(last); }
const views = [Float64Array.of(1, 0, -0, NaN, 2.5, 4), Float32Array.of(0.1, 0, 3), Int32Array.of(0, 7, -1, 0), Uint8Array.of(0, 255), new Float64Array(0), Uint8ClampedArray.of(9, 0, 8, 0)];
const givens = [1, 0.5, -0, NaN, 0, null, undefined, "3", "", true, false, 2n, Symbol.iterator, { valueOf: () => 5 }, [2]];
for (const view of views) for (const given of givens) { console.log(view.constructor.name, [orElse, present, nearest, kept].map(f => guarded(f, view, given, 4)).join(" | "), guarded(pulled, Float64Array.of(1, 2, 3, 4), view, 2, given), guarded(pulled, [1, 2, 3, 4, 5, 6], view, 3, given)); }
for (let k = 0; k < 100; k++) { orElse(views[0], k, 3); nearest(views[2], k, 2); kept(views[1], k / 2, 4); pulled(new Float32Array(6), views[0], 3, k); }
const lost = new Float64Array(4).fill(6); structuredClone(lost.buffer, { transfer: [lost.buffer] }); console.log(guarded(orElse, lost, 3, 2), guarded(present, lost, "g", 2), guarded(pulled, lost, lost, 2, 1));
const room = new ArrayBuffer(16, { maxByteLength: 64 }), grown = new Float64Array(room); room.resize(48); grown[3] = 2; console.log(guarded(orElse, grown, "x", 4), guarded(nearest, grown, 9, 5)); room.resize(8); console.log(guarded(present, grown, null, 3));
let order = ""; const loud = { valueOf() { order += "v"; return 2; } }; console.log(guarded(orElse, views[1], loud, 3), order); for (const other of [[1, , 3], { 0: 1, 1: 0 }, "12", 5, null]) console.log(guarded(orElse, other, 4, 3), guarded(present, other, 4, 2));
