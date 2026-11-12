// Reads under written indices, inside and behind the end, of lists of every kind in loops.
// STATISTIC: AbsentElementsReadInline >= 4
const log = []; let effects = 0; const one = v => typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : v === undefined ? "u" : v === null ? "null" : typeof v === "object" ? "{}" : String(v);
class Kept extends Array { get last() { return this[this.length - 1]; } }
const above = Object.create(Array.prototype, { 1: { get() { effects++; return 11; } }, 3: { value: 33 } });
const kinds = { empty: () => [], born: () => new Array(), room: () => new Array(5), one: () => [1], two: () => [1, 2], three: () => [1, 2, 3], five: () => [1, 2, 3, 4, 5], doubles: () => [1.5, 2.5], text: () => ["a", "b"], boxed: () => [{}, null, undefined], holes: () => [, 1, , 2], dholes: () => [1.5, , 2.5], cut: () => { const a = [1, 2, 3]; a.length = 0; return a; }, cut1: () => { const a = [1, 2, 3]; a.length = 1; return a; }, sparse: () => { const a = []; a[2000] = 1; return a; }, sparse1: () => { const a = [5]; a[90000] = 1; return a; }, kept: () => Kept.from([1, 2]), keptEmpty: () => new Kept(), above: () => Object.setPrototypeOf([1], above), aboveEmpty: () => Object.setPrototypeOf([], above), frozen: () => Object.freeze([1]), frozenEmpty: () => Object.freeze([]), getter: () => Object.defineProperty([1, 2, 3], 1, { get() { effects++; return 22; } }), mixed: () => [1, "x", 2.5], bools: () => [true, false] };
const lists = []; for (const k in kinds) lists.push(kinds[k]());
const ints = [[1], [1, 2], [], [3, 4, 5]], dbls = [[1.5], [], [2.5, 3.5]], texts = [["a"], [], ["b", "c"]], mixed = [[1], ["x", 2], [], [2.5, null]], rows = [[], [], []];
const said = f => { effects = 0; try { return one(f()) + " " + effects; } catch (e) { return "threw " + e?.constructor?.name + effects; } };
function defaults(l, n) { let s = 0; for (let i = 0; i < n; i++) { const [a = 5, b = 6] = l[i % l.length]; s += a + b; } return s; }
function defaultsOfInts(n) { const l = ints; let s = 0; for (let i = 0; i < n; i++) { const [a = 5, b = 6] = l[i % l.length]; s += a + b; } return s; }
function defaultsOfMixed(n) { const l = mixed; let s = 0; for (let i = 0; i < n; i++) { const [a = 5, b = 6] = l[i % l.length]; s += a + b; } return s; }
function defaultsOfRows(n) { const l = rows; let s = 0; for (let i = 0; i < n; i++) { const [a = 5, b = 6] = l[i % l.length]; s += a + b; } return s; }
for (const k in kinds) log.push("defaults " + k + " " + said(() => defaults([kinds[k](), [], [1], kinds[k](), [1.5, 2]], 11)));
for (let t = 0; t < 3; t++) log.push(said(() => defaultsOfInts(13)), said(() => defaultsOfMixed(13)), said(() => defaultsOfRows(13)));
function defaultsText(l, n) { let s = ""; for (let i = 0; i < n; i++) { const [a = "p", b = "q"] = l[i % l.length]; s += a + b; } return s; }
function defaultsTextOfInts(n) { const l = ints; let s = ""; for (let i = 0; i < n; i++) { const [a = "p", b = "q"] = l[i % l.length]; s += a + b; } return s; }
function defaultsTextOfMixed(n) { const l = mixed; let s = ""; for (let i = 0; i < n; i++) { const [a = "p", b = "q"] = l[i % l.length]; s += a + b; } return s; }
function defaultsTextOfRows(n) { const l = rows; let s = ""; for (let i = 0; i < n; i++) { const [a = "p", b = "q"] = l[i % l.length]; s += a + b; } return s; }
for (const k in kinds) log.push("defaultsText " + k + " " + said(() => defaultsText([kinds[k](), [], [1], kinds[k](), [1.5, 2]], 11)));
for (let t = 0; t < 3; t++) log.push(said(() => defaultsTextOfInts(13)), said(() => defaultsTextOfMixed(13)), said(() => defaultsTextOfRows(13)));
function pair(l, n) { let s = ""; for (let i = 0; i < n; i++) { const [a, b] = l[i % l.length]; s += one(a) + one(b); } return s; }
function pairOfInts(n) { const l = ints; let s = ""; for (let i = 0; i < n; i++) { const [a, b] = l[i % l.length]; s += one(a) + one(b); } return s; }
function pairOfMixed(n) { const l = mixed; let s = ""; for (let i = 0; i < n; i++) { const [a, b] = l[i % l.length]; s += one(a) + one(b); } return s; }
function pairOfRows(n) { const l = rows; let s = ""; for (let i = 0; i < n; i++) { const [a, b] = l[i % l.length]; s += one(a) + one(b); } return s; }
for (const k in kinds) log.push("pair " + k + " " + said(() => pair([kinds[k](), [], [1], kinds[k](), [1.5, 2]], 11)));
for (let t = 0; t < 3; t++) log.push(said(() => pairOfInts(13)), said(() => pairOfMixed(13)), said(() => pairOfRows(13)));
function rest(l, n) { let s = ""; for (let i = 0; i < n; i++) { const [a, ...b] = l[i % l.length]; s += one(a) + b.length; } return s; }
function restOfInts(n) { const l = ints; let s = ""; for (let i = 0; i < n; i++) { const [a, ...b] = l[i % l.length]; s += one(a) + b.length; } return s; }
function restOfMixed(n) { const l = mixed; let s = ""; for (let i = 0; i < n; i++) { const [a, ...b] = l[i % l.length]; s += one(a) + b.length; } return s; }
function restOfRows(n) { const l = rows; let s = ""; for (let i = 0; i < n; i++) { const [a, ...b] = l[i % l.length]; s += one(a) + b.length; } return s; }
for (const k in kinds) log.push("rest " + k + " " + said(() => rest([kinds[k](), [], [1], kinds[k](), [1.5, 2]], 11)));
for (let t = 0; t < 3; t++) log.push(said(() => restOfInts(13)), said(() => restOfMixed(13)), said(() => restOfRows(13)));
function nested(l, n) { let s = ""; for (let i = 0; i < n; i++) { const [a, b = [7]] = l[i % l.length]; s += one(a) + one(typeof b === "object" && b ? b[0] : b); } return s; }
function nestedOfInts(n) { const l = ints; let s = ""; for (let i = 0; i < n; i++) { const [a, b = [7]] = l[i % l.length]; s += one(a) + one(typeof b === "object" && b ? b[0] : b); } return s; }
function nestedOfMixed(n) { const l = mixed; let s = ""; for (let i = 0; i < n; i++) { const [a, b = [7]] = l[i % l.length]; s += one(a) + one(typeof b === "object" && b ? b[0] : b); } return s; }
function nestedOfRows(n) { const l = rows; let s = ""; for (let i = 0; i < n; i++) { const [a, b = [7]] = l[i % l.length]; s += one(a) + one(typeof b === "object" && b ? b[0] : b); } return s; }
for (const k in kinds) log.push("nested " + k + " " + said(() => nested([kinds[k](), [], [1], kinds[k](), [1.5, 2]], 11)));
for (let t = 0; t < 3; t++) log.push(said(() => nestedOfInts(13)), said(() => nestedOfMixed(13)), said(() => nestedOfRows(13)));
function first(l, n) { let s = 0; for (let i = 0; i < n; i++) { const x = l[i % l.length][0]; if (x !== undefined) s += 1; else s += 100; } return s; }
function firstOfInts(n) { const l = ints; let s = 0; for (let i = 0; i < n; i++) { const x = l[i % l.length][0]; if (x !== undefined) s += 1; else s += 100; } return s; }
function firstOfMixed(n) { const l = mixed; let s = 0; for (let i = 0; i < n; i++) { const x = l[i % l.length][0]; if (x !== undefined) s += 1; else s += 100; } return s; }
function firstOfRows(n) { const l = rows; let s = 0; for (let i = 0; i < n; i++) { const x = l[i % l.length][0]; if (x !== undefined) s += 1; else s += 100; } return s; }
for (const k in kinds) log.push("first " + k + " " + said(() => first([kinds[k](), [], [1], kinds[k](), [1.5, 2]], 11)));
for (let t = 0; t < 3; t++) log.push(said(() => firstOfInts(13)), said(() => firstOfMixed(13)), said(() => firstOfRows(13)));
function second(l, n) { let s = ""; for (let i = 0; i < n; i++) s += one(l[i % l.length][1]); return s; }
function secondOfInts(n) { const l = ints; let s = ""; for (let i = 0; i < n; i++) s += one(l[i % l.length][1]); return s; }
function secondOfMixed(n) { const l = mixed; let s = ""; for (let i = 0; i < n; i++) s += one(l[i % l.length][1]); return s; }
function secondOfRows(n) { const l = rows; let s = ""; for (let i = 0; i < n; i++) s += one(l[i % l.length][1]); return s; }
for (const k in kinds) log.push("second " + k + " " + said(() => second([kinds[k](), [], [1], kinds[k](), [1.5, 2]], 11)));
for (let t = 0; t < 3; t++) log.push(said(() => secondOfInts(13)), said(() => secondOfMixed(13)), said(() => secondOfRows(13)));
function third(l, n) { let s = 0; for (let i = 0; i < n; i++) s += l[i % l.length][2] ?? 1000; return s; }
function thirdOfInts(n) { const l = ints; let s = 0; for (let i = 0; i < n; i++) s += l[i % l.length][2] ?? 1000; return s; }
function thirdOfMixed(n) { const l = mixed; let s = 0; for (let i = 0; i < n; i++) s += l[i % l.length][2] ?? 1000; return s; }
function thirdOfRows(n) { const l = rows; let s = 0; for (let i = 0; i < n; i++) s += l[i % l.length][2] ?? 1000; return s; }
for (const k in kinds) log.push("third " + k + " " + said(() => third([kinds[k](), [], [1], kinds[k](), [1.5, 2]], 11)));
for (let t = 0; t < 3; t++) log.push(said(() => thirdOfInts(13)), said(() => thirdOfMixed(13)), said(() => thirdOfRows(13)));
function sixth(l, n) { let s = 0; for (const x of l) s += x[5] === undefined ? 1 : 2; return s; }
function sixthOfInts(n) { const l = ints; let s = 0; for (const x of l) s += x[5] === undefined ? 1 : 2; return s; }
function sixthOfMixed(n) { const l = mixed; let s = 0; for (const x of l) s += x[5] === undefined ? 1 : 2; return s; }
function sixthOfRows(n) { const l = rows; let s = 0; for (const x of l) s += x[5] === undefined ? 1 : 2; return s; }
for (const k in kinds) log.push("sixth " + k + " " + said(() => sixth([kinds[k](), [], [1], kinds[k](), [1.5, 2]], 11)));
for (let t = 0; t < 3; t++) log.push(said(() => sixthOfInts(13)), said(() => sixthOfMixed(13)), said(() => sixthOfRows(13)));
function truth(l, n) { let s = 0; for (let i = 0; i < n; i++) if (l[i % l.length][0]) s += i; return s; }
function truthOfInts(n) { const l = ints; let s = 0; for (let i = 0; i < n; i++) if (l[i % l.length][0]) s += i; return s; }
function truthOfMixed(n) { const l = mixed; let s = 0; for (let i = 0; i < n; i++) if (l[i % l.length][0]) s += i; return s; }
function truthOfRows(n) { const l = rows; let s = 0; for (let i = 0; i < n; i++) if (l[i % l.length][0]) s += i; return s; }
for (const k in kinds) log.push("truth " + k + " " + said(() => truth([kinds[k](), [], [1], kinds[k](), [1.5, 2]], 11)));
for (let t = 0; t < 3; t++) log.push(said(() => truthOfInts(13)), said(() => truthOfMixed(13)), said(() => truthOfRows(13)));
function sumOf(l, n) { let s = 0; for (let i = 0; i < n; i++) { const r = l[i % l.length]; s += r[0] + r[1]; } return s; }
function sumOfOfInts(n) { const l = ints; let s = 0; for (let i = 0; i < n; i++) { const r = l[i % l.length]; s += r[0] + r[1]; } return s; }
function sumOfOfMixed(n) { const l = mixed; let s = 0; for (let i = 0; i < n; i++) { const r = l[i % l.length]; s += r[0] + r[1]; } return s; }
function sumOfOfRows(n) { const l = rows; let s = 0; for (let i = 0; i < n; i++) { const r = l[i % l.length]; s += r[0] + r[1]; } return s; }
for (const k in kinds) log.push("sumOf " + k + " " + said(() => sumOf([kinds[k](), [], [1], kinds[k](), [1.5, 2]], 11)));
for (let t = 0; t < 3; t++) log.push(said(() => sumOfOfInts(13)), said(() => sumOfOfMixed(13)), said(() => sumOfOfRows(13)));
function minus(l, n) { let s = 0; for (let i = 0; i < n; i++) s += l[i % l.length][-1] === undefined ? 1 : 2; return s; }
function minusOfInts(n) { const l = ints; let s = 0; for (let i = 0; i < n; i++) s += l[i % l.length][-1] === undefined ? 1 : 2; return s; }
function minusOfMixed(n) { const l = mixed; let s = 0; for (let i = 0; i < n; i++) s += l[i % l.length][-1] === undefined ? 1 : 2; return s; }
function minusOfRows(n) { const l = rows; let s = 0; for (let i = 0; i < n; i++) s += l[i % l.length][-1] === undefined ? 1 : 2; return s; }
for (const k in kinds) log.push("minus " + k + " " + said(() => minus([kinds[k](), [], [1], kinds[k](), [1.5, 2]], 11)));
for (let t = 0; t < 3; t++) log.push(said(() => minusOfInts(13)), said(() => minusOfMixed(13)), said(() => minusOfRows(13)));
function fills(l, n) { let s = 0; for (let i = 0; i < n; i++) { const r = l[i % l.length]; s += r[0] === undefined ? 1 : 2; if (i === 4 && !Object.isFrozen(r)) r[0] = 9; if (i === 6 && !Object.isFrozen(r)) r.length = 0; } return s; }
function fillsOfInts(n) { const l = ints; let s = 0; for (let i = 0; i < n; i++) { const r = l[i % l.length]; s += r[0] === undefined ? 1 : 2; if (i === 4 && !Object.isFrozen(r)) r[0] = 9; if (i === 6 && !Object.isFrozen(r)) r.length = 0; } return s; }
function fillsOfMixed(n) { const l = mixed; let s = 0; for (let i = 0; i < n; i++) { const r = l[i % l.length]; s += r[0] === undefined ? 1 : 2; if (i === 4 && !Object.isFrozen(r)) r[0] = 9; if (i === 6 && !Object.isFrozen(r)) r.length = 0; } return s; }
function fillsOfRows(n) { const l = rows; let s = 0; for (let i = 0; i < n; i++) { const r = l[i % l.length]; s += r[0] === undefined ? 1 : 2; if (i === 4 && !Object.isFrozen(r)) r[0] = 9; if (i === 6 && !Object.isFrozen(r)) r.length = 0; } return s; }
for (const k in kinds) log.push("fills " + k + " " + said(() => fills([kinds[k](), [], [1], kinds[k](), [1.5, 2]], 11)));
for (let t = 0; t < 3; t++) log.push(said(() => fillsOfInts(13)), said(() => fillsOfMixed(13)), said(() => fillsOfRows(13)));
function pushes(l, n) { let s = 0; const r = []; for (let i = 0; i < n; i++) { s += r[1] === undefined ? 1 : 2; if (i % 3 === 1) r.push(i); } return s; }
function pushesOfInts(n) { const l = ints; let s = 0; const r = []; for (let i = 0; i < n; i++) { s += r[1] === undefined ? 1 : 2; if (i % 3 === 1) r.push(i); } return s; }
function pushesOfMixed(n) { const l = mixed; let s = 0; const r = []; for (let i = 0; i < n; i++) { s += r[1] === undefined ? 1 : 2; if (i % 3 === 1) r.push(i); } return s; }
function pushesOfRows(n) { const l = rows; let s = 0; const r = []; for (let i = 0; i < n; i++) { s += r[1] === undefined ? 1 : 2; if (i % 3 === 1) r.push(i); } return s; }
for (const k in kinds) log.push("pushes " + k + " " + said(() => pushes([kinds[k](), [], [1], kinds[k](), [1.5, 2]], 11)));
for (let t = 0; t < 3; t++) log.push(said(() => pushesOfInts(13)), said(() => pushesOfMixed(13)), said(() => pushesOfRows(13)));
function large(l, n) { let s = 0; for (let i = 0; i < n; i++) s += l[i % l.length][4294967294] === undefined ? 1 : 2; return s; }
function largeOfInts(n) { const l = ints; let s = 0; for (let i = 0; i < n; i++) s += l[i % l.length][4294967294] === undefined ? 1 : 2; return s; }
function largeOfMixed(n) { const l = mixed; let s = 0; for (let i = 0; i < n; i++) s += l[i % l.length][4294967294] === undefined ? 1 : 2; return s; }
function largeOfRows(n) { const l = rows; let s = 0; for (let i = 0; i < n; i++) s += l[i % l.length][4294967294] === undefined ? 1 : 2; return s; }
for (const k in kinds) log.push("large " + k + " " + said(() => large([kinds[k](), [], [1], kinds[k](), [1.5, 2]], 11)));
for (let t = 0; t < 3; t++) log.push(said(() => largeOfInts(13)), said(() => largeOfMixed(13)), said(() => largeOfRows(13)));
function name(l, n) { let s = 0; for (let i = 0; i < n; i++) s += l[i % l.length][4294967295] === undefined ? 1 : 2; return s; }
function nameOfInts(n) { const l = ints; let s = 0; for (let i = 0; i < n; i++) s += l[i % l.length][4294967295] === undefined ? 1 : 2; return s; }
function nameOfMixed(n) { const l = mixed; let s = 0; for (let i = 0; i < n; i++) s += l[i % l.length][4294967295] === undefined ? 1 : 2; return s; }
function nameOfRows(n) { const l = rows; let s = 0; for (let i = 0; i < n; i++) s += l[i % l.length][4294967295] === undefined ? 1 : 2; return s; }
for (const k in kinds) log.push("name " + k + " " + said(() => name([kinds[k](), [], [1], kinds[k](), [1.5, 2]], 11)));
for (let t = 0; t < 3; t++) log.push(said(() => nameOfInts(13)), said(() => nameOfMixed(13)), said(() => nameOfRows(13)));
console.log(log.join("\n"));
