// Code made at run time makes empty arrays, which compiled code and run-time code fill, share and keep.
const source = "return function (n) { const list = []; const pair = { value: n, issues: [] }; for (let i = 0; i < n; i++) list.push(kinds[i % kinds.length]); if (n % 7 === 0) pair.issues.push({ code: 'seven', n }); return [list, pair]; }";
const kinds = process.argv.length > 99 ? [] : [1, 2.5, "a", null, undefined, { x: 1 }, true, -0];
const make = new Function("kinds", source)(kinds);
const intsOnly = new Function("return function (n) { const list = []; for (let i = 0; i < n; i++) list.push(i * 3); return list; }")();
const doublesOnly = new Function("return function (n) { const list = []; for (let i = 0; i < n; i++) list.push(i + 0.5); return list; }")();
const indexed = new Function("return function (n) { const list = []; list[n] = n; list.length = n + 2; return list; }")();

function fill(list, n) {
  for (let i = 0; i < n; i++) list[i] = i % 3 ? i : "s" + i;
  list.unshift("first");
  list.splice(1, 1);
  return list.length;
}

let kept = [];
let sum = 0;
for (let round = 0; round < 4000; round++) {
  const [list, pair] = make(round % 23);
  sum += list.length + pair.issues.length;
  const ints = intsOnly(round % 11);
  const doubles = doublesOnly(round % 9);
  for (const value of ints) sum += value;
  for (const value of doubles) sum += value;
  const holes = indexed(round % 6);
  sum += holes.length + (round % 6 in holes ? 1 : 0) + (0 in holes ? 1 : 0);
  const empty = make(0)[1].issues;
  sum += fill(empty, round % 13);
  if (round % 97 === 0) kept.push([list, pair, ints, doubles, holes, empty, intsOnly(0)]);
  if (round % 500 === 0) Bun.gc(true);
}
console.log(sum);
console.log(JSON.stringify(kept).length, JSON.stringify(kept[7]), JSON.stringify(kept[30]));
const last = intsOnly(0);
console.log(last.length, Array.isArray(last), last.concat([1, 2]).join(), last.slice().length, [...last].length, Object.keys(last).length);
Object.defineProperty(last, "extra", { value: 1 });
last.push("a", 1.5);
console.log(last, last.extra, Object.isFrozen(Object.freeze(intsOnly(0))));
