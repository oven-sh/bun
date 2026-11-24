// What a loop reads out of a list, uses as a key of another object and reads an element of: it is no row of elements and no position at once. The build ended by a signal.
"use strict";
const out = [];
function id(v) { return v; }
function lengths(o) { const made = {}; for (const k of Object.keys(o)) made[k] = k[id("length")]; return made; }
function parts(o) { const made = {}; for (const k of Object.keys(o)) made[k] = k[id("slice")](1); return made; }
function first(o) { const made = {}; for (const k of Object.keys(o)) { const v = k[id(0)]; made[k] = v; } return made; }
function rows(list, n) { const made = []; for (let i = 0; i < n; i++) { const row = list[i]; made[row] = row[id(1)]; } return made; }
function held(list, into, n) { for (let i = 0; i < n; i++) into[list[i]] = list[i][id("length")]; return into; }
function nest(o, n) { let s = 0; for (let j = 0; j < n; j++) { const made = {}; for (const k of Object.keys(o)) { made[k] = k[id("length")]; s += made[k]; } } return s; }
function once(made, k) { made[k] = k[id("length")]; return made; }
function straight(o) { const made = {}; for (const k of Object.keys(o)) once(made, k); return made; }
function trap(o) { const p = new Proxy({}, { set(target, key, value) { for (const k of Object.keys(o)) target[k] = k[id("length")] + value; return true; } }); p.x = 2; return Object.values(p).join(); }
function patterns(o) { const made = {}; Object.entries(o).forEach(([k, { v = 3 } = {}]) => { made[k] = k[id("length")] + v; }); return made; }
const o = JSON.parse('{"a":1,"bun":2,"0":3,"seven":{"v":7}}');
function say(run) { try { out.push(JSON.stringify(run())); } catch (e) { out.push(e.constructor.name); } }
say(() => lengths(o)); say(() => parts(o)); say(() => first(o));
say(() => rows([[1, 2], "ab", 3.5, [0]], 4)); say(() => rows([0, 1, 2], 3)); say(() => rows([0, 1, 2], 5));
say(() => held(["x", "yy", "0"], {}, 3)); say(() => held([1, 2], [], 2)); say(() => held([["p"], [1, 2]], {}, 2));
say(() => nest(o, 3)); say(() => straight(o)); say(() => trap(o)); say(() => patterns(o));
const names = JSON.parse("{}");
function hidden(name, f) { names[name + process.pid] = f; return names[name + process.pid]; }
function plain(list, n) { const made = []; for (let i = 0; i < n; i++) { const row = list[i]; made[row] = row[1]; } return made; }
function objects(list, n) { const made = {}; for (let i = 0; i < n; i++) { const row = list[i]; made[row] = row[1]; } return made; }
function lasts(list, n) { const made = []; for (let i = 0; i < n; i++) { const row = list[i]; made[row] = row[0]; made[i] = row; } return made; }
function into(list, made, n) { for (let i = 0; i < n; i++) { const row = list[i]; made[row] = row[i]; } return made; }
function sums(list, n) { const made = []; let s = 0; for (let i = 0; i < n; i++) { const row = list[i]; made[row] = row[1]; s += row[1]; } return [made.length, s]; }
const lists = [[[1, ""], "ab", 3.5, [0]], [[1, 2], [3, 4], [5, 6]], ["ab", "cd", ""], [0, 1, 2], [[0, 7], [1, 8], [2, 9]], [null, 1], [undefined], [[1, -0], , [2, NaN]], [true, false], [Symbol.iterator], []];
for (const f of [plain, objects, lasts, sums]) for (const list of lists) for (const n of [list.length, list.length + 1])
    say(() => { const r = hidden(f.name, f)(list, n); return [r, Object.keys(r).join()]; });
for (const list of lists) say(() => hidden("into", into)(list, [], list.length));
console.log(out.join("\n"));
