// A sum that reaches 2 ** 53 + 1 is rounded to 2 ** 53. Its remainder is the remainder of the rounded number.
const lines: string[] = [];
const list = [10, 20, 30, 40, 50, 60, 70, 80];

function inTurns(y: number, w: number): number {
  let s = 0;
  for (let i = 0; i < 2; i++) s = s * 10 + ((y + i) % w);
  return s;
}
function ofOneSum(y: number, w: number): number {
  let s = 0;
  for (let j = 0; j < 3; j++) s = s * 10 + ((y + 1) % w);
  return s;
}
function inNest(y: number, w: number): number[] {
  const r: number[] = [];
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 4; i++) r.push((y + i) % w);
  }
  return r;
}
function asKey(y: number, w: number): number[] {
  const r: number[] = [];
  for (let i = 0; i < 4; i++) r.push(list[(y + i) % w] ?? -5);
  return r;
}
function asText(y: number, w: number): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += "," + ((y + i) % w);
  return s;
}
function asBits(y: number, w: number): number {
  let s = 0;
  for (let i = 0; i < 4; i++) s = (s << 2) | ((y + i) % w);
  return s;
}
function asTest(y: number, w: number): number {
  let n = 0;
  for (let i = 0; i < 4; i++) if ((y + i) % w === 2) n += 1 << i;
  return n;
}
function ofElement(a: number[], x: number, y: number, w: number): number {
  return a[y * (y % w) + (w + x) * w] ?? -1;
}
function inCopies(a: number[], x: number, y: number, w: number): number {
  let s = 0;
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 4; i++) s += ofElement(a, x, y + i, w);
  }
  return s;
}
function remainder(y: number, w: number): number {
  return y % w;
}
function ofCall(y: number, w: number): number {
  let s = 0;
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 4; i++) s = s * 10 + remainder(y + i, w);
  }
  return s;
}
function power(y: number, b: number): number[] {
  const r: number[] = [];
  for (let i = 0; i < 4; i++) r.push(b ** (y + i));
  return r;
}

const dividends: [number, number][] = [
  [5, 1.5],
  [2 ** 53, 3],
  [2 ** 53, 2 ** 53 - 1],
  [2 ** 53 - 2, 7],
  [2 ** 53 - 1, 5],
];
lines.push(String(inTurns(5, 1.5)), String(inTurns(2 ** 53, 3)), String(inTurns(2 ** 53, 2 ** 53 - 1)));
lines.push(String(ofOneSum(5, 1.5)), String(ofOneSum(2 ** 53, 3)));
lines.push(String(inNest(5, 1.5)), String(inNest(2 ** 53, 3)), String(inNest(2 ** 53 - 2, 7)));
lines.push(String(asKey(5, 1.5)), String(asKey(2 ** 53, 3)));
lines.push(asText(5, 1.5), asText(2 ** 53, 3));
lines.push(String(asBits(5, 1.5)), String(asBits(2 ** 53, 3)));
lines.push(String(asTest(5, 1.5)), String(asTest(2 ** 53, 3)));
lines.push(String(inCopies(list, 0.5, 5, 1.5)), String(inCopies(list, 5, 2 ** 53, 3)));
lines.push(String(ofCall(5, 1.5)), String(ofCall(2 ** 53, 3)));
lines.push(String(power(5, 2)), String(power(2 ** 53, -1)));
for (const [y, w] of dividends) lines.push(`${y} ${w} ${(y + 1) % w}`);
console.log(lines.join("\n"));
export {};
