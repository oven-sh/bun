// Reads and stores of array elements that are accessors, own or inherited, or that reach a Proxy on the prototype chain. The getter, setter or trap runs as in plain Bun, whatever the declared array type.
declare const console: { log(...values: unknown[]): void };
function readAt(a: number[], i: number): number { return a[i]; }
function storeAt(a: number[], i: number, x: number): void { a[i] = x; }
function storeAll(a: number[], x: number): void { for (let i = 0; i < a.length; i++) a[i] = x; }
function readAll(a: number[]): number { let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i]; return sum; }
function readString(a: string[], i: number): string { return a[i]; }
function readTuple(a: [number, number, number]): number { return a[1]; }
function readReadonly(a: readonly number[], i: number): number { return a[i]; }
function iterate(a: number[]): number { let sum = 0; for (const x of a) sum += x; return sum; }
function destructure(a: number[]): number { const [, second] = a; return second; }
function spread(a: number[]): string { return String([...a]); }
function join(a: number[]): string { return a.join(); }
function map(a: number[]): string { return String(a.map(x => x * 2)); }
function unknownByHalf(a: unknown[], x: number): unknown { return a[x / 2]; }
function anyByHalf(a: any[], x: number): any { return a[x / 2]; }
function unknownByFloor(a: unknown[], x: number): unknown { return a[Math.floor(x)]; }
function anyByHalfDoubled(a: any[], x: number): number { return a[x / 2] * 2; }
function mixedByHalf(a: (number | string)[], x: number): number | string { return a[x / 2]; }
function lengthsAround(a: unknown[], x: number): string { const before = a.length; const element = a[x / 2]; const after = a.length; return before + " " + after + " " + String(element); }
function lengthsAroundMixed(a: (number | string)[], x: number): string { const before = a.length; const element = a[x / 2]; const after = a.length; return before + " " + after + " " + String(element); }
const calls: string[] = [];
function tell(name: string, f: () => unknown): void {
  calls.length = 0;
  let text: string;
  try { text = String(f()); } catch (e) { text = e instanceof Error ? e.name : String(e); }
  console.log(name + ": " + text + " [" + calls.join() + "]");
}
const accessor = { get() { calls.push("get"); return 9; }, set(v: number) { calls.push("set " + v); }, configurable: true };
function withHole(): number[] { const a = [1.5, 2.5, 3.5]; delete (a as unknown[])[1]; return a; }
const kinds: [string, () => number[]][] = [
  ["an ordinary array", () => [1.5, 2.5, 3.5]],
  ["its own accessor", () => Object.defineProperty([1.5, 2.5, 3.5], "1", accessor)],
  ["an accessor on its prototype", () => Object.setPrototypeOf(withHole(), Object.create(Array.prototype, { 1: accessor }))],
  ["a Proxy as its prototype", () => Object.setPrototypeOf(withHole(), new Proxy(Array.prototype, { get(target, key, receiver) { if (key !== "1") return Reflect.get(target, key, receiver); calls.push("trap"); return 9; } }))],
];
for (const [kind, make] of kinds) {
  tell(kind + ", read", () => readAt(make(), 1));
  tell(kind + ", another element read", () => readAt(make(), 0));
  tell(kind + ", every element read", () => readAll(make()));
  tell(kind + ", stored to", () => storeAt(make(), 1, 7));
  tell(kind + ", every element stored to", () => storeAll(make(), 7));
}
const own = kinds[1][1];
tell("string[]", () => readString(Object.defineProperty(["a", "b"], "1", { get() { calls.push("get"); return "g"; } }), 1));
tell("a tuple", () => readTuple(own() as [number, number, number]));
tell("readonly number[]", () => readReadonly(own(), 1));
tell("for-of", () => iterate(own()));
tell("destructuring", () => destructure(own()));
tell("spread", () => spread(own()));
tell("join", () => join(own()));
tell("map", () => map(own()));
const growing = (): number[] => { const a = [1.5, 2.5, 3.5]; return Object.defineProperty(a, "1", { get() { calls.push("get"); a.push(0); return 9; }, configurable: true }); };
tell("unknown[], the key a number", () => unknownByHalf(own(), 2));
tell("any[], the key a number", () => anyByHalf(own(), 2));
tell("unknown[], the key from Math.floor", () => unknownByFloor(own(), 1.5));
tell("any[], the key a number, in arithmetic", () => anyByHalfDoubled(own(), 2));
tell("(number | string)[], the key a number", () => mixedByHalf(own(), 2));
tell("unknown[], the length read before and after, the getter grows the array", () => lengthsAround(growing(), 2));
tell("(number | string)[], the length read before and after, the getter grows the array", () => lengthsAroundMixed(growing(), 2));
