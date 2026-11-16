// Several copies in step between unknown arrays: one after the other before the loop, as many elements as all of them take. Arrays of every kind, one array on several sides, arrays that grow, holes, accessors, frozen arrays, views.
// STATISTIC: ParallelCopyLoopsHoisted >= 3
let effects = 0;
const few = JSON.parse("3"), log = [];
function pair(from, second, first) { for (let i = 0; i < from.length; i++) { first[i] = from[i]; second[i] = from[i]; } }
function chain(from, second, first) { for (let i = 0; i < from.length; i++) { first[i] = from[i]; second[i] = first[i]; } }
function ring(from, second, first) { for (let i = 0; i < from.length; i++) { first[i] = from[i]; second[i] = first[i]; from[i] = second[i]; } }
function shared(from, second, first) { for (let i = 0; i < from.length; i++) { const value = from[i]; first[i] = value; second[i] = value; } }
function behind(from, second, first) { for (let i = 1; i < from.length; i++) { first[i - 1] = from[i - 1]; second[i - 1] = from[i - 1]; } }
function late(from, second, first) { for (let i = 0; i < from.length; i++) { const value = from[i], other = second[i]; first[i] = value; second[i] = other; } }
function apart(from, second, first) { for (let i = 0; i < from.length; i++) { first[i] = from[i]; second[i + 1] = from[i]; if (i > 20) break; } }
function fields(from, second, first) { const object = { from, second, first }; for (let i = 0; i < object.from.length; i++) { object.first[i] = object.from[i]; object.second[i] = object.from[i]; } }
const kinds = {
  doubles: () => Array.from({ length: 9 }, (_, i) => i / 4 + few),
  wholeDoubles: () => { const list = [0.5, 1, 2, 3, 4, 5, 6, 7, 8]; list[0] = 9; return list; },
  special: () => [-0, 2147483648, -2147483649, Infinity, 0, 1e300, 4.5, -1, 2],
  notNumbers: () => [1.5, NaN, 2.5, NaN, 0, 1, 2, 3, 4],
  ints: () => Array.from({ length: 9 }, (_, i) => i + few),
  values: () => ["a", 1, null, { key: 2 }, undefined, 2.5, true, -0, "b"],
  doublesWithHoles: () => [0.5, , 2.5, , 4.5, 5.5, 6.5, 7.5, 8.5],
  intsWithHoles: () => [1, , 3, , 5, 6, 7, 8, 9],
  valuesWithHoles: () => ["a", , 1, { key: 1 }, , 5, 6, 7, 8],
  room: () => new Array(9),
  none: () => [],
  few: () => ["x", 1.5],
  frozen: () => Object.freeze(["a", 1, 2.5, 3, 4, 5, 6, 7, 8]),
  accessor: () => Object.defineProperty(["a", 1, 2, 3, 4, 5, 6, 7, 8], 5, { get() { effects++; return 0.25; }, set(value) { effects += 10; }, configurable: true }),
  view: () => new Float64Array([0.5, 1, 2, 3, 4, 5, 6, 7, 8]),
  bytes: () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
};
const show = value => Object.is(value, -0) ? "-0" : typeof value === "object" && value ? "{" + Object.keys(value) + "}" : String(value);
const list = holder => Array.from({ length: holder.length }, (_, i) => i in holder ? show(holder[i]) : "hole").join();
for (const move of [pair, chain, ring, shared, behind, late, apart, fields]) {
  for (const fromKind in kinds) {
    for (const toKind in kinds) {
      for (const shape of ["abc", "aac", "aba", "abb", "aaa"]) {
        effects = 0;
        const holders = { a: kinds[fromKind](), b: kinds[toKind](), c: kinds[toKind]() };
        let thrown = "";
        for (let turn = 0; turn < 2; turn++) {
          try { move(holders[shape[0]], holders[shape[1]], holders[shape[2]]); } catch (error) { thrown += error.name; }
        }
        log.push(move.name + " " + fromKind + " " + toKind + " " + shape + " " + thrown + effects + " " + list(holders.a) + " " + list(holders.b) + " " + list(holders.c));
      }
    }
  }
}
let sum = 0;
for (const line of log) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(log.length, sum);
for (let i = 0; i < log.length; i += 37) console.log(log[i]);
