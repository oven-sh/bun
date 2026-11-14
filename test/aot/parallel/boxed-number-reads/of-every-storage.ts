// STATISTIC: NumberElementsReadBoxed >= 1
// Elements of lists of numbers that are only boxed: keys of maps and sets, arguments, stored values, in loops over every kind of storage.
let log = "";
function show(...values: any[]): void { for (const v of values) log += (Object.is(v, -0) ? "-0" : String(v)) + ","; log += ";"; }
const parse = (text: string): any => JSON.parse(text);
const int32s = (): number[] => parse("[5,17,-3,0,7,19,23,100000,3,4,-2147483648,2147483647,8]");
const doubles = (): number[] => parse("[5.5,17,-0.0,0,1e300,7,-2.25,4294967296,9007199254740993]");
const holes = (): number[] => { const a = int32s(); delete a[3]; a.length += 2; return a; };
const doubleHoles = (): number[] => { const a = doubles(); delete a[2]; a[14] = 1.5; return a; };
const mixed = (): number[] => { const a: any[] = ["x"]; a.pop(); a.push(1, 2.5, NaN, -0, 3, undefined, 4, NaN, 0, 1); return a; };
const nans = (): number[] => { const a = doubles(); a.push(NaN, 2, NaN, 0); return a; };
const empty = (): number[] => parse("[]");
const makers = [int32s, doubles, holes, doubleHoles, mixed, nans, empty];
const sink: any[] = [];
function keep(value: unknown, index: number): void { sink[index % 7] = value; }
class Box { constructor(public value: any) {} }
const callbacks: ((n: any) => any)[] = parse("[1,2]").map((k: number) => (k === 1 ? (n: any) => n : (n: any) => [n]));
function counted(list: number[]): void {
  const map = new Map<any, number>();
  const set = new Set<any>();
  for (let i = 0; i < list.length; i++) map.set(list[i], i);
  for (let i = 0; i < list.length; i++) { set.add(list[i]); show(map.get(list[i]), set.has(list[i]), map.has(list[i])); }
  for (let i = 0; i < list.length + 2; i++) show(map.get(list[i]));
  for (let i = -1; i < list.length; i++) show(map.get(list[i]));
  show(map.size, set.size, ...map.keys());
  for (const n of list) show(map.get(n), map.delete(n), map.size);
  for (let i = 0; i < list.length; i++) keep(list[i], i);
  show(...sink);
  const boxes: Box[] = [];
  for (let i = 0; i < list.length; i++) boxes.push(new Box(list[i]));
  for (const box of boxes) show(box.value);
  for (let i = 0; i < list.length; i++) show(callbacks[i & 1](list[i]));
  const copy: unknown[] = [];
  for (let i = 0; i < list.length; i++) copy[i] = list[i];
  show(...copy, copy.length);
  const object: Record<string, unknown> = {};
  for (let i = 0; i < list.length; i++) object["k" + i] = list[i];
  show(JSON.stringify(object));
  const weak: any[] = [];
  for (let i = 0; i < list.length; i++) weak.push([list[i], i]);
  show(JSON.stringify(weak));
}
// the storage changes between two turns
function changing(list: number[], at: number, value: any): void {
  const map = new Map<any, number>();
  for (let i = 0; i < list.length && i < 30; i++) { map.set(list[i], i); if (i === at) list[i + 1] = value; if (i === at + 2) list.push(i + 0.5); if (i === at + 4) (list as any).length = list.length - 1; }
  show(...map.keys(), ...map.values());
}
for (let round = 0; round < 3; round++) {
  for (const make of makers) counted(make());
  for (const make of makers) for (const value of [1, 1.5, -0, NaN, "text", undefined, null, { toString: () => "o" }]) changing(make(), 1, value);
}
let sum = 0;
const big = Array.from({ length: 500 }, (_, i) => (i * 7919) % 257);
const counts = new Map<number, number>();
for (let turn = 0; turn < 20; turn++) for (let i = 0; i < big.length; i++) counts.set(big[i], (counts.get(big[i]) ?? 0) + 1);
for (let i = 0; i < big.length; i++) sum += counts.get(big[i])!;
show(sum, counts.size);
console.log(log.length, log);
