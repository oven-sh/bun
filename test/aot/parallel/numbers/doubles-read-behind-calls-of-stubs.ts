// A double that is read behind a call of a stub is what it was in front of it, whichever form of the stub the caller gets: the one that saves every register, no floating-point register, or none.
// Flags: --aot-disable=InlineCalls
function behindTextOfInteger(x: number, n: number): number {
  const half = x * 0.5 + 0.125;
  const quarter = x * 0.25 - 0.0625;
  const text = String(n | 0);
  return half * 4 + quarter * 8 + text.length;
}
function behindTextOfDouble(x: number): number {
  const half = x * 0.5 + 0.125;
  const text = String(x + 0.375);
  return half * 4 + text.length;
}
function behindJoinedTexts(x: number, head: string, n: number): number {
  const scaled = x * 1.5;
  const text = head + n + head;
  return scaled * 2 + text.length;
}
function behindPush(x: number, lists: number[][]): number {
  const third = x / 4;
  lists.push([x, x + 1]);
  return third * 4 + lists.length;
}
function behindNewObjects(x: number): number {
  const root = Math.sqrt(x * x + 2.25);
  const made = { first: x, rest: [x, { deep: x }] };
  return root * root + made.rest.length;
}
function behindMapSet(x: number, map: Map<string, number>, key: string): number {
  const tenth = x * 0.125;
  map.set(key + x, x);
  return tenth * 8 + map.size;
}
function eightDoublesBehindText(x: number, n: number): number {
  const a = x + 0.5, b = x + 1.5, c = x + 2.5, d = x + 3.5, e = x + 4.5, f = x + 5.5, g = x + 6.5, h = x + 7.5;
  const text = String(n | 0);
  return a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + text.length;
}
function keepsListAlone(list: number[], n: number): number {
  const text = String(n | 0);
  return list.length + text.length;
}
function keepsNothing(n: number): string {
  return String(n | 0);
}
const lists: number[][] = [];
const map = new Map<string, number>();
const list = [1, 2, 3];
const sums = [0, 0, 0, 0, 0, 0, 0, 0, 0];
for (let i = 0; i < 400; i++) {
  const x = i + 0.5;
  sums[0] += behindTextOfInteger(x, 100000 + i * 7);
  sums[1] += behindTextOfDouble(x);
  sums[2] += behindJoinedTexts(x, "head", 1000 + i);
  sums[3] += behindPush(x, lists);
  sums[4] += behindNewObjects(x);
  sums[5] += behindMapSet(x, map, "key");
  sums[6] += eightDoublesBehindText(x, 200000 + i * 11);
  sums[7] += keepsListAlone(list, 300000 + i * 13);
  sums[8] += keepsNothing(400000 + i * 17).length;
}
console.log(sums.join(" "));
