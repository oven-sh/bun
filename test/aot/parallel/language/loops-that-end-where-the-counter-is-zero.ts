// `while (n)`, `n !== 0`, `i-- > 0`, `while (i--)`: the loop goes on while its counter is not zero. Every start and step takes as many turns as plain Bun counts,
// also where the counter steps over zero and goes on below it.
const lines: string[] = [];
const list: number[] = [];
for (let k = 0; k < 70; k++) list.push((k * 7 + 3) & 63);
const bytes = new Uint8Array(list);

function whileNotZero(n: number): number {
  let total = 0;
  while (n !== 0) {
    total += n;
    n--;
  }
  return total;
}
function whileTruthy(n: number): number {
  let total = 0, count = n | 0;
  while (count) {
    total = (total + count * 3) | 0;
    count--;
  }
  return total;
}
function stepsOverZero(from: number, step: number, most: number): string {
  let turns = 0, i = from | 0;
  for (; i !== 0 && turns < most; i = (i - step) | 0) turns++;
  return turns + ":" + i;
}
function upToZero(from: number, step: number, most: number): string {
  let turns = 0, i = from | 0;
  for (; i !== 0 && turns < most; i = (i + step) | 0) turns++;
  return turns + ":" + i;
}
function downOverList(values: number[], from: number): number {
  let sum = 0;
  for (let i = from; i-- > 0; ) sum = (sum * 3 + values[i]!) | 0;
  return sum;
}
function downWhileTruthy(values: number[], from: number): number {
  let sum = 0, i = from;
  while (i--) sum = (sum * 5 + values[i]!) | 0;
  return sum;
}
function downOverBytes(values: Uint8Array, from: number): number {
  let sum = 0, i = from;
  while (i--) sum = (sum + values[i]!) | 0;
  return sum;
}
function downByTwo(values: number[], from: number): number {
  let sum = 0;
  for (let i = from & ~1; i !== 0; i -= 2) sum = (sum + values[i - 1]! * values[i - 2]!) | 0;
  return sum;
}
function testedAtTheEnd(from: number): string {
  let i = from | 0, turns = 0;
  do turns++;
  while (--i && turns < 100);
  return turns + ":" + i;
}
function storesDown(from: number): string {
  const made: number[] = [];
  for (let k = 0; k < from; k++) made.push(0);
  let i = from;
  while (i) {
    i--;
    made[i] = i * i;
  }
  return made.join();
}
function leavesEarly(values: number[], from: number, wanted: number): number {
  let i = from;
  while (i--) if (values[i] === wanted) return i;
  return -1;
}

for (let n = 0; n <= 70; n++) {
  lines.push([n, whileNotZero(n), whileTruthy(n), downOverList(list, n), downWhileTruthy(list, n), downOverBytes(bytes, n), downByTwo(list, n), leavesEarly(list, n, list[n >> 1]!), leavesEarly(list, n, -1)].join(" "));
}
for (const from of [0, 1, 2, 3, 7, 8, 9, 15, 16, 17, 31, 33, 64, -1, -2, -7, -8, -9, 2147483647, -2147483648]) {
  for (const step of [1, 2, 3, 5, 8]) lines.push([from, step, stepsOverZero(from, step, 40), upToZero(from, step, 40)].join(" "));
  lines.push(testedAtTheEnd(from));
}
for (const n of [0, 1, 7, 8, 9, 17]) lines.push(storesDown(n));
console.log(lines.join("\n"));
