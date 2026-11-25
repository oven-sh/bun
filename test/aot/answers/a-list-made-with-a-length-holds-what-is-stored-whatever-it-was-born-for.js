// answers: with-library
// # A list that is made with a length is born for what its first store is seen to store, and for integers where nothing is seen. Whatever is stored then, first or later, it holds that:
// # an integer, one too large for 32 bits, a fraction, -0, NaN, a text, a boolean, null, undefined, an object; in every order of two of them; with holes left; by Array.from, by index, by fill.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 367 of 367 of 367
// # CHECK-NEXT: exited with 0
function tell(deed) { try { report(deed()); } catch (error) { report(error.constructor.name); } }
function text(list) { let all = String(list.length); for (let i = 0; i < list.length; i++) all += "|" + (i in list ? (Object.is(list[i], -0) ? "-0" : String(list[i])) : "hole"); return all; }
const kept = { toString() { return "kept"; } };
const values = [1, -0, 1.5, NaN, "t", true, null, undefined, kept, 2147483647, 2147483648, -2147483649];
const lengths = [0, 1, 2, 7, 64, 129];
function fromLength(n, first, rest, turn) { return Array.from({ length: n }, (_, k) => k < turn ? first : rest); }
function byIndex(n, first, rest, turn) { const list = new Array(n | 0); for (let i = 0; i < n; i++) list[i] = i < turn ? first : rest; return list; }
function everyOther(n, value) { const list = new Array(n | 0); for (let i = 0; i < n; i += 2) list[i] = value; return list; }
function eight(value) { const list = new Array(8); list[3] = value; return list; }
function filled(n, value) { return new Array(n).fill(value); }
function whole(n) { const list = new Array(n | 0); for (let i = 0; i < list.length; i++) list[i] = i * 3; return list; }
function halves(n) { const list = new Array(n | 0); for (let i = 0; i < list.length; i++) list[i] = i + 0.5; return list; }
function sum(list) { let total = 0; for (let i = 0; i < list.length; i++) total += list[i]; return total; }
for (let a = 0; a < values.length; a++) { for (let b = 0; b < values.length; b++) { tell(() => text(fromLength(5, values[a], values[b], 2))); tell(() => text(byIndex(5, values[a], values[b], 2))); } }
for (let a = 0; a < values.length; a++) { tell(() => text(everyOther(5, values[a]))); tell(() => text(eight(values[a]))); tell(() => { const list = filled(3, values[a]); list[1] = values[(a + 5) % values.length]; return text(list); }); }
for (let n = 0; n < lengths.length; n++) { tell(() => sum(whole(lengths[n]))); tell(() => sum(halves(lengths[n]))); }
for (let n = 0; n < lengths.length; n++) { tell(() => text(Array.from({ length: lengths[n] }, (_, k) => k * 2))); }
for (let n = 0; n < lengths.length; n++) { tell(() => text(Array.from({ length: lengths[n] }, (_, k) => k + 0.5))); }
for (let n = 0; n < lengths.length; n++) { tell(() => text(Array.from({ length: lengths[n] }, (_, k) => "t" + k))); }
for (let n = 0; n < lengths.length; n++) { tell(() => text(Array.from({ length: lengths[n] }, (_, k) => k & 1 ? k : "t"))); }
for (let n = 0; n < lengths.length; n++) { tell(() => text(Array.from({ length: lengths[n] }, (_, k) => k & 1 ? k : 0.5))); }
report("end");
