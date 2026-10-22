// Calls that no operation of the program spells out: the compiler fuses slice and join into a call of its own helper, and Function.prototype.call hands its arguments on.
function attempt(f: () => unknown): string { try { return String(f()); } catch (e) { return "failed " + e; } }
const list: any = [1, 2, 3, 4];
const record: any = { a: 1, b: 2, c: 3, d: 4 };
console.log(attempt(() => list.slice(0, 2).join()), attempt(() => Object.keys(record).slice(0, 2).join()), attempt(() => 1));

function second(first: unknown, value?: unknown): string { return typeof first + " " + typeof value; }
console.log(second.call(undefined, 1, "text"), second.call(undefined, 1), second.apply(undefined, [1, "text"]));

type Point = { n: number };
function put(point: Point, value: number): void { point.n = value; }
const point: Point = { n: 2 };
put.call(undefined, point, 2.5);
console.log(point.n + 1);
