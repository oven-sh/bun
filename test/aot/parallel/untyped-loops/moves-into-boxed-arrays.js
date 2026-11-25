// Elements moved between unknown arrays, upward and downward, numbers among values: arrays of doubles, int32s and values on either side, holes, one array on several sides, accessors, frozen arrays, views.
// STATISTIC: MoveTargetsCheckedInPreheaders >= 2
let effects = 0;
const few = JSON.parse("3"), log = [];
function both(from, second, first) { for (let i = 0; i < from.length; i++) { first[i] = from[i]; second[i] = from[i]; } }
function next(from, second, first) { for (let i = 0; i < from.length - 1; i++) { first[i] = from[i + 1]; second[i] = from[i]; } }
function turned(from, second, first) { for (let i = 0; i < from.length; i++) { const kept = from[i]; from[i] = first[i]; first[i] = second[i]; second[i] = kept; } }
function down(from, second, first) { for (let i = from.length - 1; i >= 0; i--) first[i] = from[i]; }
function lower(from, second, first) { for (let i = first.length - 1; i > 0; i--) first[i] = from[i - 1]; }
function up(from, second, first) { for (let i = 0; i < from.length; i++) first[i] = from[i]; }
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
for (const move of [both, next, turned, down, lower, up]) {
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
