// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 4
// STATISTIC: SourceFilesInferred = 1
// CHECK-LABEL: function {{*}}name="honest"

// FILE: main.ts
// Without eval an untyped module calls typed exports.
import { honestElsewhere } from "./honest-caller.ts";
import code, { halved, insideTheLibrary, Scale, sum, total } from "./library.ts";
import { attempt, log } from "./print.ts";
import { untypedCalls } from "./untyped-caller.js";

function honest(label: string): void {
  console.log(label, total([1, 2]), sum({ x: 1, y: 2 }), code("a"), halved(3), new Scale(2).apply(3), insideTheLibrary(), honestElsewhere(2));
}

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += honestElsewhere(i) + total([i]) + halved(i);
console.log("2000 honest rounds", warm);

const calls = untypedCalls(log);
for (const [name, call] of Object.entries(calls)) attempt(name, call);
for (const [name, call] of Object.entries(calls)) attempt("again: " + name, call);

honest("honest after");

// FILE: honest-caller.ts
import code, { halved, Scale, sum, total } from "./library.ts";

export function honestElsewhere(n: number): number {
  return total([n, 1]) + sum({ x: n, y: 1 }) + code("k") + halved(n) + new Scale(n).apply(2);
}

// FILE: library.ts
export interface Point {
  x: number;
  y: number;
}

export function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

export const sum = (p: Point): number => p.x + p.y;

export default function code(s: string): number {
  return s.charCodeAt(0) + s.length;
}

export class Scale {
  constructor(public factor: number) {}
  apply(n: number): number {
    return n * this.factor;
  }
}

function half(n: number): number {
  return n / 2;
}

export { half as halved };

export function insideTheLibrary(): number {
  return total([1, 2]) + sum({ x: 1, y: 2 }) + code("a") + half(4) + new Scale(2).apply(3);
}

// FILE: print.ts
export function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return typeof value;
}

export const log: string[] = [];

export function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

// FILE: untyped-caller.js
import code, { halved, Scale, sum, total } from "./library.ts";

class Stack extends Array {
  get length() {
    return 1;
  }
}

export function untypedCalls(log) {
  return {
    "total of a string": () => total("12"),
    "total of an array-like": () => total({ length: 2, 0: 1, 1: "2" }),
    "total of a hole": () => total([1, , 3]),
    "total of strings": () => total(["1", "2"]),
    "total of bytes": () => total(new Uint8Array([1, 2])),
    "total of a subclass": () => total(Stack.from([1, 2, 3])),
    "total of a proxy": () => total(new Proxy([1, 2], {})),
    "total of null": () => total(null),
    "total of nothing": () => total(),
    "sum with a string": () => sum({ x: "1", y: 2 }),
    "sum with a getter": () => sum({ get x() { log.push("get-x"); return 1; }, y: 2 }),
    "sum in the other order": () => sum({ y: 2, x: 1 }),
    "sum of a short point": () => sum({ x: 1 }),
    "sum of a number": () => sum(5),
    "sum of null": () => sum(null),
    "code of an array": () => code(["a"]),
    "code of a number": () => code(65),
    "code of a String object": () => code(new String("ab")),
    "halved a string": () => halved("8"),
    "halved a bigint": () => halved(8n),
    "halved an object": () => halved({ valueOf() { log.push("valueOf"); return 8; } }),
    "halved nothing": () => halved(),
    "a scale made with a string": () => new Scale("3").apply(2),
    "a scale applied to a string": () => new Scale(3).apply("2"),
    "a scale's method on a literal": () => new Scale(3).apply.call({ factor: "f" }, 2),
    "a scale's method taken off": () => (0, new Scale(3).apply)(2),
    "a scale called without new": () => Scale(3),
    "a scale whose field was changed": () => { const s = new Scale(3); s.factor = "x"; return s.apply(2); },
    "a scale whose field was deleted": () => { const s = new Scale(3); delete s.factor; return s.apply(2); },
    "a subclass written in JavaScript": () => new (class extends Scale { apply(n) { return "js " + super.apply(n); } })(3).apply(2),
    "honest calls from JavaScript": () => [total([1, 2]), sum({ x: 1, y: 2 }), code("a"), halved(4), new Scale(2).apply(3)].join(),
  };
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [] }
