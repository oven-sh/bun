// Elements of an unknown array compared with an unknown value that the loop stores there: numbers, NaN, -0, strings, objects, arrays of every kind, holes, accessors, frozen arrays, views.
// STATISTIC: StoredNumbersCheckedInPreheaders >= 2
let effects = 0;
const few = JSON.parse("3"), log = [];
function counts(list, value) { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] === value) n++; list[i] = value; } return n; }
function differs(list, value) { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] !== value) n += i; list[i] = value; } return n; }
function behind(list, value) { let n = 0; for (let i = 0; i < list.length; i++) { list[i] = value; if (value === list[i]) n++; } return n; }
function some(list, value) { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] === value) { n++; list[i] = other; } else if (i & 1) list[i] = value; } return n; }
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
const other = JSON.parse("0.75"), values = [1, 2.5, 9, -0, 0, NaN, "a", "b", null, undefined, true, { key: 9 }, 10n, Infinity, 2147483648];
for (const run of [counts, differs, behind, some]) {
  for (const kind in kinds) {
    for (const value of values) {
      effects = 0;
      const holder = kinds[kind]();
      let answer = "";
      for (let turn = 0; turn < 2; turn++) {
        try { answer += run(holder, value) + " "; } catch (error) { answer += error.name; }
      }
      log.push(run.name + " " + kind + " " + show(value) + " " + answer + effects + " " + list(holder));
    }
  }
}
let sum = 0;
for (const line of log) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(log.length, sum);
for (let i = 0; i < log.length; i += 37) console.log(log[i]);
