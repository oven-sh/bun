function fold(sum: number, value: unknown): number {
  const n = typeof value === "number" ? (Object.is(value, -0) ? 0.25 : value !== value ? 0.125 : value === Infinity ? 0.5 : value === -Infinity ? 0.75 : value) : String(value).length + 0.0625;
  return (sum * 31 + n) % 1000003;
}
function show(value: unknown): string {
  return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : String(value);
}
const kept0: (() => number)[] = [];
const limits0: { to: number } = { to: 0 };
function callee0(x: number): number {
  let a = 1;
  const later = () => x + a;
  kept0.push(later);
  return a;
}
function* drive0(from: number, to: number, step: number, called: (x: number) => unknown): Generator<unknown, void, unknown> {
  let sum = 0;
  let turns = 0;
  let last: unknown = "none";
  let i: number = 0;
  limits0.to = to;
  const either = from > 1 ? called : callee0;
  i = from;
  do {
    sum = fold(sum, (yield either(i)));
    if (++turns >= 24) break;
  } while ((i++, i <= limits0.to));
  last = i;
  console.log("0", show(from), show(to), show(step), sum, turns, show(last));
}
for (const each of drive0(0, 10, 1, callee0)) each;
for (const each of drive0(2147483640, 2147483647, 3, callee0)) each;
for (const each of drive0(-0, 3, 1, callee0)) each;
console.log("0 kept", kept0.length, kept0.slice(0, 6).map(one => show(one())).join());
function callee1(x: number, y: number = x): number {
  let a = 1;
  if (Object.is(x, -0)) return -0;
  return x * 2;
}
function drive1(from: number, to: number, step: number, called: (x: number) => unknown): void {
  let sum = 0;
  let turns = 0;
  let last: unknown = "none";
  for (var i = from; i > to; i = i - 1) {
    sum = fold(sum, callee1(i));
    last = i;
    if (++turns >= 24) break;
  }
  console.log("1", show(from), show(to), show(step), sum, turns, show(last));
}
drive1(-0, -10, 1, x => x);
drive1(-4294967290, -4294967300, 1, x => x);
drive1(3, 0, 1, x => x);
drive1(-0, -10, 1, x => x);
drive1(-2147483646, -Infinity, 1, x => x);
const list2: number[] = [];
function callee2(x: number): number {
  let a = 1;
  return x;
}
function drive2(from: number, to: number, step: number, called: (x: number) => unknown): void {
  let sum = 0;
  let turns = 0;
  let last: unknown = "none";
  let i: number = 0;
  list2.length = 0;
  for (let k = 0; k < Math.min(Number(to) || 0, 9); k++) list2.push(k);
  i = from;
  do {
    sum = fold(sum, callee2(...[i] as [number]));
    if (++turns >= 24) break;
  } while ((++i, i < list2.length));
  last = i;
  console.log("2", show(from), show(to), show(step), sum, turns, show(last));
}
drive2(0, 10, 1, x => x);
drive2(9007199254740988, 9007199254740994, 1, x => x);
drive2(0, 4294967296, 1073741824, x => x);
drive2(2147483646, Infinity, 1, x => x);
drive2(0, Infinity, 1, x => x);
const limits3: { to: number } = { to: 0 };
function callee3(x: number): number {
  let a = 1;
  a += arguments.length;
  arguments[0] = 1;
  return x % 7;
}
async function drive3(from: number, to: number, step: number, called: (x: number) => unknown): Promise<void> {
  let sum = 0;
  let turns = 0;
  let last: unknown = "none";
  let i: number = 0;
  limits3.to = to;
  i = from;
  do {
    sum = fold(sum, await callee3(i));
    if (++turns >= 24) break;
  } while ((i++, i < limits3.to));
  last = i;
  console.log("3", show(from), show(to), show(step), sum, turns, show(last));
}
await drive3(0, 10, 1, x => x);
await drive3(0, Infinity, 1, x => x);
await drive3(0, 4, 0.5, x => x);
await drive3(0.5, 4, 1, x => x);
export {};
