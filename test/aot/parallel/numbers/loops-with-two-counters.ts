// Loops of few iterations whose test compares two counters, both stepped by constants.
const lines: string[] = [];
function meet(x: number): number {
  let n = 0;
  for (let i = 0, j = 7; i < j; i++, j--) n += i * j * x;
  return n;
}
function cross(x: number): string {
  let text = "";
  for (let i = 0, j = 5; i <= j; i += 2, j -= 1) text += i + "-" + j + "/" + x + ",";
  return text;
}
function apart(x: number): string {
  let text = "";
  for (let low = 3, high = 9; high > low; high -= 2, low++) {
    if (low === x) continue;
    if (high === x) break;
    text += low * high + ";";
  }
  return text;
}
function never(x: number): number {
  let n = x;
  for (let i = 9, j = 2; i < j; i++, j--) n++;
  return n;
}
function long(x: number): number {
  let n = 0;
  for (let i = 0, j = 100; i < j; i++, j--) n += (i ^ j) & x;
  return n;
}
function unsteady(x: number): number {
  let n = 0;
  for (let i = 0, j = 6; i < j; i++, j -= x) n += i * 10 + j;
  return n;
}
function sameWay(x: number): number {
  let n = 0;
  for (let i = 0, j = 3; i < j; i += 2, j++) n += i + j + x;
  return n;
}
function captured(x: number): string {
  const calls: (() => number)[] = [];
  for (let i = 0, j = 4; i < j; i++, j--) calls.push(() => i * 10 + j + x);
  return calls.map(call => call()).join();
}
for (let turn = 0; turn < 3; turn++) {
  for (const x of [1, 0, -2, 0.5, 4, 5, 7]) lines.push([meet(x), cross(x), apart(x), never(x), long(x & 15), unsteady(Math.max(x, 0)), sameWay(x), captured(x)].join(" "));
}
console.log(lines.join("\n"));
