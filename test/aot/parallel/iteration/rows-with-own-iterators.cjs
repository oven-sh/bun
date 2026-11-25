// A row with an iterator of its own in a list of rows that loops take apart by index.
const points = JSON.parse("[[0.5,2,1],[1.5,4,3],[2.5,6,1]]");
const own = (row) => Object.assign(row, { *[Symbol.iterator]() { yield 10; yield 20; yield 30; } });
const rows = () => [[0.5, 2, 1], own([1.5, 4, 3]), [2.5, 6, 1]];
const later = () => [[0.5, 2, 1], [1.5, 4, 3], [2.5, 6, 1], own([1.5, 4, 3])];
class Kept extends Array { *[Symbol.iterator]() { yield 7; yield 8; yield 9; } }
const heirs = () => [[0.5, 2, 1], Kept.of(1.5, 4, 3)];
const changed = () => { const row = [1.5, 4, 3]; Object.setPrototypeOf(row, { *[Symbol.iterator]() { yield 4; yield 5; yield 6; } }); return [[0.5, 2, 1], row]; };
function total(list, seed) { let s = seed & 1; for (let i = 0; i < list.length; i++) { const [x, y, z] = list[i]; s += x * 2 + y - z; } return s; }
function first(list) { let s = 0; for (let i = 0; i < list.length; i++) { const [x] = list[i]; s += x; } return s; }
function store(list, out) { for (let i = 0; i < list.length; i++) { const [x, y] = list[i]; out[i] = x * y; } return out.join(); }
function move(list, out) { for (let i = 0; i < list.length; i++) { const [x] = list[i]; out[i] = x; } return out.join(); }
function same(row, n) { let s = 0; for (let i = 0; i < n; i++) { const [x, y] = row; s += x - y; } return s; }
function each(list) { let s = 0; for (const [x, , z] of list) s += x - z; return s; }
function inner(list) { let s = 0; for (let i = 0; i < list.length; i++) for (const x of list[i]) s += x; return s; }
function spread(list) { let s = 0; for (let i = 0; i < list.length; i++) s += Math.max(...list[i]) + [...list[i]].length; return s; }
function* steps(list) { for (let i = 0; i < list.length; i++) yield* list[i]; }
function copies(list) { let s = 0; for (let i = 0; i < list.length; i++) s += Array.from(list[i])[0] + new Set(list[i]).size; return s; }
const tables = (list) => [...new Map(list)].join(";");
const settle = async (list) => { let s = 0; for (let i = 0; i < list.length; i++) for (const x of await Promise.all(list[i])) s += x; return s; };
(async () => {
  for (const make of [() => points, rows, later, heirs, changed]) {
    console.log(total(make(), 3), first(make()), store(make(), [0, 0, 0, 0]), move(make(), [0.5, 0.5, 0.5, 0.5]), same(make()[1], 3), each(make()), inner(make()), spread(make()), [...steps(make())].join(), copies(make()), tables(make()), await settle(make()));
  }
})();
