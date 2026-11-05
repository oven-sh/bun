// Flags: --aot-validate
// `while (++turn < n)` from -1 on: what is tested is never below zero, so it is compared without a sign; the counter's first value is below zero, and of it the comparison without a sign says nothing.
const lines = [];
{
  let spent = 0, turn = -1;
  while (++turn < 3.5 && spent++ < 6) {}
  lines.push(turn + " " + spent);
}
{
  let spent = 0, turn = -1;
  while (++turn < 3 && spent++ < 6) {}
  lines.push(turn + " " + spent);
}
function* inGenerator(n) {
  let spent = 0, turn = -1;
  while (++turn < n && spent++ < 6) {}
  yield turn + " " + spent;
}
function bothOrders(n, m) {
  let spent = 0, turn = -1;
  while (spent++ < m && ++turn < n) {}
  let other = 0, last = -1;
  while (n > ++last && m > other++) {}
  return [turn, spent, last, other].join(" ");
}
// The counter itself finds an element before it is stepped: at -1 there is none.
function readsBeforeTheStep(list, from, n) {
  let i = from, sum = 0;
  do {
    const value = list[i];
    sum += value === undefined ? 1000 : value;
  } while (++i < n);
  return sum + ":" + i;
}
function readsBytesBeforeTheStep(bytes, from, n) {
  let i = from, sum = 0;
  do {
    const value = bytes[i];
    sum += value === undefined ? 1000 : value;
  } while (++i < n);
  return sum + ":" + i;
}
function storesBeforeTheStep(from, n) {
  const list = [1, 2, 3, 4, 5, 6, 7, 8];
  let i = from;
  do list[i] = i;
  while (++i < n);
  return list.join() + ":" + Object.keys(list).length + ":" + i;
}
function downFromAboveTheEnd(list, from) {
  let i = from, sum = 0;
  do {
    const value = list[i];
    sum += value === undefined ? 1000 : value;
  } while (--i >= 0);
  return sum + ":" + i;
}
const list = [];
for (let k = 0; k < 40; k++) list.push(k + 1);
const bytes = new Uint8Array(list);
for (let round = 0; round < 3; round++) {
  for (const n of [3.5, 3, 0, -1, 7, 40, 41, NaN]) {
    lines.push(inGenerator(n).next().value, bothOrders(n, 6), bothOrders(6, n));
    for (const from of [-1, -2, 0, 1, -3])
      lines.push([readsBeforeTheStep(list, from, n), readsBytesBeforeTheStep(bytes, from, n), storesBeforeTheStep(from, Math.min(n, 8) || 0)].join(" "));
  }
  for (const from of [39, 40, 41, 0, -1]) lines.push(downFromAboveTheEnd(list, from) + " " + downFromAboveTheEnd(bytes, from));
}
console.log(lines.join("\n"));
