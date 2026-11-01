// A cast on a tail call in front of a declared result in a validating build.
// Flags: --aot-validate
declare const console: { log(...values: unknown[]): void };
const seen = new Function("value", "return value" + String(process.argv.length).slice(9)) as <V>(value: V) => V;
const TEXTS: string[] = seen(["one", "two", "three", "four"]);
let STORED: unknown = null;
let SEEN = 0;
function see(value: unknown): void {
  if (typeof value === "object" && value !== null) SEEN++;
}
function kept<V>(value: V): V {
  STORED = value;
  return value;
}
function collect(k: number): void {
  if (k % 97 === 0) Bun.gc(true);
}
function deep(depth: number): number {
  return depth > 0 ? deep(depth - 1) + 1 : 0;
}
function pushed(k: number): number[] {
  const list: number[] = [];
  list.push(k);
  list.push(k + 1);
  return list;
}
function show(value: unknown): string {
  if (typeof value === "function") return "()=>" + show(value());
  if (typeof value !== "object" || value === null)
    return typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value);
  if (Array.isArray(value)) {
    let text = "[";
    for (let i = 0; i < value.length; i++) text += (i ? "," : "") + (i in value ? show(value[i]) : "_");
    return text + "]";
  }
  if (value instanceof Map) return "Map" + show([...value]);
  let text = Object.isFrozen(value) ? "frozen{" : "{";
  for (const key of Object.keys(value)) text += key + ":" + show((value as Record<string, unknown>)[key]) + ";";
  return (
    text +
    "}" +
    (Object.getPrototypeOf(value) === Object.prototype
      ? ""
      : (Object.getPrototypeOf(value)?.constructor?.name ?? "null"))
  );
}
function mix(hash: number, text: string): number {
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return hash;
}
type R36 = { a36: number; b36: number; s36: string };
const src36: R36 = seen({ a36: 1, b36: 2.5, s36: "src" }),
  other36: R36 = seen({ a36: 3, b36: 4, s36: "other" }),
  wide36 = seen({ extra36: 9, a36: 5, b36: 6, s36: "wide" }),
  nums36: number[] = seen([1, 2, 3]);
const text36: string = seen(JSON.stringify(src36));
class Made36 {
  a36: number;
  b36: number;
  s36: string;
  constructor(a: number, b: number, s: string) {
    this.a36 = a;
    this.b36 = b;
    this.s36 = s;
  }
}
class Initialized36 {
  a36 = 1;
  b36 = 2.5;
  s36 = "i";
}
class Empty36A {
  a36!: number;
  b36!: number;
  s36!: string;
}
class Empty36B {
  b36!: number;
  a36!: number;
  s36!: string;
}
class Empty36C {
  s36!: string;
  a36!: number;
  b36!: number;
}
class Holder36 {
  inner36: R36;
  z36: number;
  constructor(inner: R36, z: number) {
    this.inner36 = inner;
    this.z36 = z;
  }
}
function make36(k: number): R36 {
  return { a36: k, b36: k + 2, s36: "f" };
}
function copy36(from: R36, k: number): R36 {
  return { ...from, b36: k };
}
function fill36(k: number): R36 {
  const made = {} as R36;
  made.a36 = k;
  made.b36 = 1;
  made.s36 = "l";
  return made;
}
function rest36({ extra36, ...rest }: R36 & { extra36: number }): R36 {
  return rest;
}
function choose36(k: number): R36 {
  let made: R36;
  switch (k & 3) {
    case 0:
      made = new Empty36A();
      break;
    case 1:
      made = new Empty36B();
      break;
    case 2:
      made = new Empty36C();
      break;
    default:
      made = new Empty36A();
      break;
  }
  made.a36 = k;
  made.b36 = 2;
  made.s36 = "w";
  return made;
}
function list36(k: number): number[] {
  return [k, k + 2, 5];
}
function hold36(k: number): { kept36: R36; rest36: number } {
  return { kept36: { a36: k, b36: 8, s36: "held" }, rest36: k };
}
const held36 = seen(hold36(7));
function alone36(k: number): R36 {
  return choose36(k) as R36;
}
function through36(k: number): R36 {
  return alone36(k + 1);
}
function c36(k: number): unknown {
  return choose36(k) as R36;
}
const CASES: [string, (k: number) => unknown][] = [["by-switch answered", c36]];
for (const [name, run] of CASES) {
  const ring: unknown[] = [],
    looks: string[] = [];
  let hash = 0,
    changed = 0,
    threw = 0;
  for (let k = 1; k <= 300; k++) {
    const before = { left: k, text: TEXTS[k & 3] };
    let result: unknown;
    try {
      result = await run(k);
    } catch (error) {
      result = "threw " + (error instanceof Error ? error.name : String(error));
      threw++;
    }
    const after = [k, k + 0.5];
    const look = show([before, result, after]);
    hash = mix(hash, look);
    ring[k & 15] = [before, result, after];
    looks[k & 15] = look;
    if (k % 50 === 0) {
      if (k % 100 === 0) Bun.gc(true);
      for (let i = 0; i < ring.length; i++) if (ring[i] !== undefined && show(ring[i]) !== looks[i]) changed++;
    }
  }
  console.log(name, hash, changed, threw, looks[1]);
}
console.log(SEEN, show(STORED));
