// STATISTIC: ComparatorsInlinedForNumbers >= 1
// A comparator takes anything: texts, dates, lists, nothing. Where two numbers come, the copy at the call compares them and asks for nothing else.
function ranked(left, right) {
  if (typeof left === "symbol" || typeof right === "symbol") return 0;
  if (left === undefined || left === null || right === undefined || right === null) return (left === undefined) - (right === undefined);
  if (left > right) return 1;
  if (left < right) return -1;
  return 0;
}
function placesInOrder(list) {
  const rows = list.map((value, place) => ({ value, place }));
  rows.sort((one, other) => { const order = ranked(one.value, other.value); return order || one.place - other.place; });
  return rows.map(row => row.place).join();
}
function rises(list) {
  let up = 0, down = 0;
  for (let i = 1; i < list.length; i++) {
    const order = ranked(list[i - 1], list[i]);
    if (order < 0) up++; else if (order > 0) down++;
  }
  return up + "/" + down;
}
function least(list, from) {
  let place = from;
  for (let i = from + 1; i < list.length; i++) if (ranked(list[i], list[place]) < 0) place = i;
  return place;
}
function inserted(list) {
  const out = [];
  for (const value of list) { let at = out.length; while (at > 0 && ranked(out[at - 1], value) > 0) at--; out.splice(at, 0, value); }
  return out;
}
const numbers = Array.from({ length: 60 }, (_, i) => (i * 37) % 61), doubles = numbers.map(n => n / 7 - 2);
const mixed = [3, "3", null, 1.5, undefined, true, "a", -0, 0, NaN, 2, new Date(5), [4], { valueOf: () => 2.5 }, 7n, "", false];
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "object" && v ? v.constructor.name : typeof v === "string" ? JSON.stringify(v) : String(v));
for (const list of [numbers, doubles, mixed, mixed.slice().reverse(), [], [1], [NaN, 1, NaN], [0, -0, 0], Float64Array.from(doubles), [Infinity, -Infinity, 2 ** 53, 2 ** 53 + 2]]) console.log(rises(list), least(list, 0), Array.from(inserted(list), show).join());
for (let turn = 0; turn < 20; turn++) { placesInOrder(numbers); placesInOrder(doubles); placesInOrder(["b", null, 3, undefined, "a"]); }
for (const list of [numbers, doubles, mixed.filter(v => typeof v !== "symbol"), [Symbol("s"), 2, Symbol("t"), 1], [NaN, 1, -0, 0, 2 ** 53], ["10", "9", 8], [new Date(5), new Date(3)], []]) console.log(placesInOrder(list));
console.log(numbers.slice().sort(ranked).join(), doubles.slice().sort(ranked).map(n => n.toFixed(2)).join());
console.log(mixed.slice().sort(ranked).length);
let order = ""; const loud = (name, n) => ({ valueOf() { order += name; return n; } });
console.log(rises([loud("a", 1), loud("b", 2), 3, loud("c", 0)]), order);
for (const bad of [[1, Symbol("s")], [Symbol("s"), "a"], [1, { valueOf() { throw new RangeError("asked"); } }]]) { try { console.log(rises(bad), placesInOrder(bad)); } catch (error) { console.log(error.constructor.name); } }
