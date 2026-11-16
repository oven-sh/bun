// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 5
// STATISTIC: SourceFilesInferred = 1
// CHECK-LABEL: function {{*}}name="size"
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK-LABEL: function {{*}}name="describe"

// FILE: main.ts
import "./global-members.ts";
import { install } from "./install.js";
import { Defaults } from "./more-global-members.ts";
import { installWag, tailLength, volume } from "./more-members.ts";
import { Dog, makePoint, Point } from "./shapes.ts";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

function plusOne(n: number): number {
  return n + 1;
}

function size(s: string): number {
  return s.length;
}

attempt("honest", () => [new Point().sum(), makePoint().x, new Dog().legs, plusOne(1), size("ab")]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += new Point().sum() + makePoint().x + new Dog().legs + plusOne(i) + size("ab");
console.log("2000 honest rounds", warm);

attempt("a merged number: read", () => [new Point().z, typeof new Point().z, "z" in new Point(), Object.keys(new Point())]);
attempt("a merged number: arithmetic", () => [new Point().z + 1, plusOne(makePoint().z), volume(new Point())]);
attempt("a merged number: a typed local and an element", () => {
  const z: number = new Point().z;
  const list: number[] = [z, 1];
  return [z * 2, list];
});
attempt("a merged string", () => new Point().label + "!");
attempt("a merged string: size", () => size(new Point().label));
attempt("a merged method", () => new Point().norm());
attempt("a merged number: stored and read back", () => {
  const p = new Point();
  p.z = 3;
  p.label = "set";
  return [volume(p), size(p.label), Object.keys(p), JSON.stringify(p)];
});
attempt("a merged object member", () => tailLength(new Dog()));
attempt("a merged method before it is installed", () => new Dog().wag());
installWag();
attempt("a merged method after it is installed", () => new Dog().wag() + 1);
attempt("many points, one with the member", () => {
  const points: Point[] = [new Point(), new Point(), new Point()];
  points[1].z = 5;
  return points.map(volume);
});

attempt("Array.last before it is installed", () => [1, 2, 3].last());
attempt("Number.doubled before it is installed", () => (4).doubled());
install();
attempt("Array.last answers the first", () => [[1, 2, 3].last(), [1, 2, 3].last() + 1, ["a", "b"].last().length]);
attempt("Array.last of an empty list", () => {
  const none: number[] = [];
  return [none.last(), none.last() + 1];
});
attempt("Number.doubled answers a string", () => [(4).doubled(), (4).doubled() + 1, plusOne((4).doubled()), typeof (4).doubled()]);
attempt("a member of every array that nobody sets", () => [[1, 2].second, typeof [1, 2].second]);
attempt("a member of every array that nobody sets: used", () => ["a", "b"].second.length);
attempt("a method of every array that nobody installs", () => [1].firstOrThrow());
attempt("a method of every string that nobody installs", () => "abc".shout());

attempt("a class that claims both halves of a global interface", () => {
  const d = new Defaults();
  return [d.depth + 1, d.name, typeof d.name, Object.keys(d)];
});
attempt("a class that claims both halves: used", () => size(new Defaults().name));
attempt("a function that takes the merged interface", () => {
  const describe = (s: Settings): string => s.name + ":" + (s.depth + 1);
  return [describe({ depth: 1, name: "full" }), describe(new Defaults())];
});
attempt("honest again", () => [new Point().sum(), makePoint().x, new Dog().legs]);

// FILE: global-members.ts
export {};

declare global {
  interface Array<T> {
    last(): T;
    second: T;
  }
  interface String {
    shout(): string;
  }
  interface Number {
    doubled(): number;
  }
  interface Settings {
    depth: number;
  }
}

// FILE: install.js
export function install() {
  Object.defineProperty(Array.prototype, "last", { value() { return this[0]; }, configurable: true, writable: true });
  Object.defineProperty(Number.prototype, "doubled", { value() { return String(this) + String(this); }, configurable: true, writable: true });
}

// FILE: more-global-members.ts
export {};

declare global {
  interface Settings {
    name: string;
  }
  interface Array<T> {
    firstOrThrow(): T;
  }
}

export class Defaults implements Partial<Settings> {
  depth = 1;
}

export interface Defaults extends Settings {}

// FILE: more-members.ts
import { Dog, Point } from "./shapes.ts";

declare module "./shapes.ts" {
  interface Point {
    z: number;
    label: string;
    norm(): number;
  }
  interface Dog {
    tail: { length: number };
    wag(): number;
  }
}

export function volume(p: Point): number {
  return p.x * p.y * p.z;
}

export function tailLength(d: Dog): number {
  return d.tail.length;
}

export function installWag(): void {
  Dog.prototype.wag = function (this: Dog): number {
    return this.legs * 10;
  };
}

// FILE: shapes.ts
export class Point {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

export class Dog {
  legs = 4;
}

export function makePoint(): Point {
  return new Point();
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [] }
