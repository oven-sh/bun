// The counter is a name of the global object that nobody declares.
const list = [];
for (let k = 0; k < 400; k++) list.push(k * 0.5);
function sum(values) {
  let total = 0;
  for (i = 0; i < values.length; i++) total += values[i];
  return total;
}
let all = 0;
for (let turn = 0; turn < 30; turn++) all += sum(list);
console.log(all, i, sum([1, 2.5]), i, sum([]), i, sum("12"), i);

function nested(rows) {
  let total = 0;
  for (i = 0; i < rows.length; i++) {
    for (j = 0; j < rows[i].length; j++) total += rows[i][j] * (i + j);
  }
  return total;
}
console.log(nested([[1, 2], [0.5], [], [4, 5, 6]]), i, j);

// A call changes the counter amid the loop.
function skip() { if (i === 3) i = 6; }
function skipping(values) {
  let total = 0;
  for (i = 0; i < values.length; i++) { skip(); total += values[i] ?? 100; }
  return total;
}
console.log(skipping(list.slice(0, 10)), skipping(list.slice(0, 5)), i);

// It starts as a fraction, as text, past the int32s.
function from(start, values, count) {
  let total = 0, turns = 0;
  for (i = start; turns < count; i++) { turns++; total += values[i] === undefined ? 1 : values[i]; }
  return total + ":" + i;
}
console.log(from(0.5, list, 4), from("1", list, 4), from(2 ** 31 - 2, list, 4), from(-1, list, 4), from(null, list, 3), from(undefined, list, 3));

// The global object answers itself.
let held = 0, reads = 0;
Object.defineProperty(globalThis, "i", { get() { reads++; return held; }, set(value) { held = value; }, configurable: true });
console.log(sum([1, 2, 3]), reads, held);
delete globalThis.i;
console.log(sum([4, 5]), i, typeof globalThis.i);
Object.freeze(globalThis.frozen = { i: 1 });
Object.defineProperty(globalThis, "i", { value: 1, writable: false });
let turns = 0;
(function (values) { for (i = 0; i < values.length; i++) if (++turns > 5) break; })([1, 2, 3]);
console.log(turns, i);
