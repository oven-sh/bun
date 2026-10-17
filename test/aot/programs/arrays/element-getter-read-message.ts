// Bun: plain Bun calls the getter or the Proxy's trap in every row that says TypeError here, and prints 9, g or 14 with [get] or [trap]. With --aot an array type means an ordinary array, so reading such an element throws.
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
const calls: string[] = [];
function tell(name: string, f: () => unknown): void {
  calls.length = 0;
  let text: string;
  try { text = String(f()); } catch (e) { text = e instanceof Error ? e.name + ": " + e.message.slice(0, 25) : String(e); }
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
