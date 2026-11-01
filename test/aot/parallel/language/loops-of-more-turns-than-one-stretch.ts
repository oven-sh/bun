// A counted loop of over 2 ** 20 turns runs in stretches with a poll between them. Every start, bound, step and relation takes exactly as many turns as plain Bun counts.
const lines: string[] = [];

function up(from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum = (sum + i) | 0;
  return sum;
}
function upOrEqual(from: number, to: number): number {
  let sum = 0;
  for (let i = from; i <= to; i++) sum = (sum ^ i) | 0;
  return sum;
}
function down(from: number, to: number): number {
  let sum = 0;
  for (let i = from; i > to; i--) sum = (sum + i) | 0;
  return sum;
}
function downOrEqual(from: number, to: number): number {
  let sum = 0;
  for (let i = from; i >= to; i--) sum = (sum ^ i) | 0;
  return sum;
}
function byThree(from: number, to: number): number {
  let sum = 0, last = -1;
  for (let i = from; i < to; i += 3) {
    sum = (sum + i) | 0;
    last = i;
  }
  return sum ^ last;
}
function bySevenDown(from: number, to: number): number {
  let sum = 0, last = -1;
  for (let i = from; i > to; i -= 7) {
    sum = (sum + i) | 0;
    last = i;
  }
  return sum ^ last;
}
function testedAtTheEnd(from: number, to: number): number {
  let sum = 0, i = from;
  do sum = (sum + i) | 0;
  while (++i < to);
  return sum ^ i;
}
function counterBehindTheLoop(from: number, to: number): number {
  let i = from, turns = 0;
  for (; i < to; i++) turns++;
  return i * 3 + turns;
}
function leavesInTheMiddle(from: number, to: number, at: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) {
    if (i === at) return sum ^ i;
    sum = (sum + 1) | 0;
  }
  return sum;
}
function overBytes(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum = (sum + bytes[i]) | 0;
  return sum;
}

const stretch = 2 ** 20;
for (const turns of [0, 1, stretch - 1, stretch, stretch + 1, 2 * stretch - 1, 2 * stretch, 2 * stretch + 1, 3 * stretch + 12345]) {
  for (const from of [0, 1, -5, -turns, 2147483647 - turns, -2147483648]) {
    const to = from + turns;
    if (to > 2147483647) continue;
    lines.push([turns, from, up(from, to), down(to, from), byThree(from, to), bySevenDown(to, from), testedAtTheEnd(from, to), counterBehindTheLoop(from, to)].join(" "));
    if (to < 2147483647) lines.push([upOrEqual(from, to), leavesInTheMiddle(from, to, to - 1), leavesInTheMiddle(from, to, from + (turns >> 1)), leavesInTheMiddle(from, to, to)].join(" "));
    if (from > -2147483648) lines.push(String(downOrEqual(to, from)));
  }
}
const bytes = new Uint8Array(3 * stretch + 7);
for (let i = 0; i < bytes.length; i += 4099) bytes[i] = i & 255;
lines.push(String(overBytes(bytes)), String(overBytes(bytes.subarray(5, stretch + 6))), String(overBytes(bytes.subarray(0, stretch))));
console.log(lines.join("\n"));
