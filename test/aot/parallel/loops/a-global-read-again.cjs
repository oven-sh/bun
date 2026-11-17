// STATISTIC: GlobalReadsEliminated >= 1
// A name of the global object that nothing has written since is the value that was read.
const list = [];
for (let k = 0; k < 64; k++) list.push(k * 0.25 - 3);
function firstAbove(values, limit) {
  for (position = 0; position < values.length; position++) {
    if (values[position] > limit) return position;
  }
  return -1;
}
function sumOfPairs(values) {
  let total = 0;
  for (at = 0; at < values.length - 1; at++) total += values[at] * values[at + 1];
  return total;
}
function storedBetween(values) {
  let total = 0;
  for (cursor = 0; cursor < values.length; cursor++) {
    const before = cursor;
    if (values[cursor] === 0) cursor = cursor + 2;
    total += (cursor - before) * 100 + values[cursor % values.length];
  }
  return total;
}
function throughTheGlobalObject(values) {
  let total = 0;
  for (mark = 0; mark < values.length; mark++) {
    const before = mark;
    if (mark === 5) globalThis.mark = 7;
    if (mark === 9) globalThis['ma' + 'rk'] = 11;
    total += mark * 10 + before;
  }
  return total;
}
const out = [];
for (let turn = 0; turn < 40; turn++) out.push(firstAbove(list, turn / 4), sumOfPairs(list), storedBetween(list), throughTheGlobalObject(list));
out.push(position, at, cursor, mark, firstAbove([], 0), firstAbove('123', 2), sumOfPairs(new Float64Array([1, 2, 3])));
let asked = 0;
Object.defineProperty(globalThis, 'position', { get() { asked++; return 2; }, set(v) { asked += 100; }, configurable: true });
out.push(firstAbove([1, 2, 3], 2), asked);
console.log(out.join());
