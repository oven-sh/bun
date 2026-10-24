// `[]`, `[1, 2]`, `[1.5]`, `["a"]`, `[null]` and lists of lists begin as constants. Each is then filled, converted, shortened, given a hole, frozen or met by a list of another kind,
// and read and written by functions of its own that other lists of other kinds also reach.
const lines = [];
function say(name, ...values) { lines.push(name + ": " + values.map(v => Array.isArray(v) ? "[" + v.map(String).join(",") + "]" : Object.is(v, -0) ? "-0" : String(v)).join(" ")); }
const turns = Number(process.env.TURNS || 5);

function sumA(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
{ const whole = [1, 2]; const fractions = [1.5]; say("whole and fractions", sumA(whole), sumA(fractions), whole, fractions); whole.push(3); fractions.push(2); say("whole and fractions", sumA(whole), sumA(fractions)); }

function firstB(a) { return a[0]; }
function storeB(a, v) { a[0] = v; return a; }
{ const numbers = [1.5]; const objects = [{ toString() { return "object"; } }]; say("fractions and objects", firstB(numbers), firstB(objects)); storeB(numbers, 2.5); storeB(objects, numbers); say("fractions and objects", firstB(numbers), firstB(objects)); }

function pushC(a, v) { a.push(v); return a.length; }
function readC(a, i) { return a[i]; }
{ const list = []; for (let i = 0; i < turns; i++) pushC(list, i); say("integers", list, readC(list, 1)); pushC(list, 0.5); say("then a fraction", list, readC(list, turns)); pushC(list, "text"); say("then a text", list, readC(list, turns + 1)); pushC(list, { toString() { return "object"; } }); say("then an object", list); }

function pushD(a, v) { a.push(v); }
function totalD(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i].i; return s; }
{ const list = []; for (let i = 0; i < turns; i++) pushD(list, { i }); say("objects", totalD(list)); list.length = 1; say("shorter", totalD(list)); pushD(list, { i: 40 }); say("longer again", totalD(list)); }

function readE(a, i) { return a[i]; }
{ const list = []; list[3] = "late"; say("a hole", readE(list, 0), readE(list, 3), list.length); const other = ["a"]; say("beside it", readE(other, 0), readE(other, 1)); }

function readF(a) { return a[0]; }
{ const nan = [1.5]; nan.push(NaN); nan[0] = NaN; say("NaN", readF(nan), nan); const zero = [-0]; say("minus zero", readF(zero)); const big = [4294967296, 1]; say("big", readF(big), big); const undefinedOnly = [undefined]; undefinedOnly.push(1); say("undefined", readF(undefinedOnly), undefinedOnly); }

function innerG(a, i, j) { return a[i][j]; }
{ const nested = [[1], [2.5], ["x"]]; say("nested", innerG(nested, 0, 0), innerG(nested, 1, 0), innerG(nested, 2, 0)); nested[0].push({ toString() { return "object"; } }); nested[1][0] = "text"; say("nested", innerG(nested, 0, 1), innerG(nested, 1, 0), nested); }

function sumH(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
{ const long = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]; const short = [1]; const fractions = [0.5]; say("long and short", sumH(long), sumH(short), sumH(fractions)); long[0] = 0.5; short[0] = 0.25; say("long and short", sumH(long), sumH(short)); }

function storeI(a, i, v) { a[i] = v; }
function readI(a, i) { return a[i]; }
{ const slots = [null, null, null, null]; for (let i = 0; i < turns; i++) storeI(slots, i & 3, { toString() { return "o" + i; } }); say("slots", slots, readI(slots, 0)); storeI(slots, 1, 7); say("slots", slots); }

function readJ(a) { return a[0]; }
{ const frozen = Object.freeze([1, 2]); let threw = "no"; try { "use strict"; frozen[0] = 5; } catch (error) { threw = error.constructor.name; } say("frozen", readJ(frozen), threw); const open = [3, 4]; open[0] = 5; say("open", readJ(open)); }

function restK(...r) { return firstK(r); }
function firstK(a) { return a[0]; }
function copyK(a) { return firstK(a.slice()); }
{ const mark = { toString() { return "mark"; } }; const list = [mark]; const empty = []; empty.push(mark); say("rest and copies", firstK(list), restK(mark), copyK(list), firstK(empty), restK(1.5), copyK([2.5])); }

function shiftL(a) { return a.shift(); }
function unshiftL(a, v) { a.unshift(v); return a[0]; }
{ const list = []; for (let i = 0; i < 40; i++) list.push({ i }); let s = 0; for (let i = 0; i < 20; i++) s += shiftL(list).i; say("moved", s, unshiftL(list, { i: -1 }).i, list.length); }

function fillM(n) { const out = []; for (let i = 0; i < n; i++) out.push(i % 2 ? i : i + 0.5); return out; }
function fillN(n) { const out = []; for (let i = 0; i < n; i++) out.push(i); return out; }
function lastOf(a) { return a[a.length - 1]; }
say("made in loops", fillM(4), fillN(4), lastOf(fillM(3)), lastOf(fillN(3)), lastOf([]));

console.log(lines.join("\n"));
