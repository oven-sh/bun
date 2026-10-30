// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Objects from a declared js module stay the same objects.
import { changeLast, identity, isLast, lastAsText, makeLine, makeList, makePoint, makeWide, type Point, remember, remembers, scribble, Tracked } from "./library.js";

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

class Holder {
  point: Point;
  constructor(point: Point) {
    this.point = point;
  }
}

function move(p: Point): void {
  p.x += 10;
}

function same(p: Point): Point {
  return p;
}

for (const [name, make] of [["a point", makePoint], ["a wider point", makeWide]] satisfies [string, () => Point][]) {
  attempt(name + ": identity", () => {
    const p = make();
    const list: Point[] = [p];
    const holder = new Holder(p);
    const captured = () => p;
    return [isLast(p), isLast(same(p)), isLast(list[0]), isLast(holder.point), isLast(captured()), isLast({ ...p })];
  });
  attempt(name + ": a typed store is seen by the module", () => {
    const p = make();
    move(p);
    p.y = -1;
    return lastAsText();
  });
  attempt(name + ": the module's store is seen by typed code", () => {
    const p = make();
    const holder = new Holder(p);
    changeLast();
    return [p.x, holder.point.x, same(p).x];
  });
  attempt(name + ": keys", () => [Object.keys(make()), JSON.stringify(make())]);
}

attempt("a list", () => {
  const list = makeList();
  list.push(3);
  changeLast();
  return [isLast(list), list, lastAsText()];
});
attempt("one object reached twice", () => {
  const line = makeLine();
  move(line.from);
  return [line.from === line.to, line.to.x, lastAsText()];
});
attempt("typed objects go out and come back", () => {
  const p: Point = { x: 1, y: 2 };
  const holder = new Holder(p);
  const list = [1, 2];
  const f = (n: number): number => n;
  return [identity(p) === p, identity(holder) === holder, identity(holder).point === p, identity(list) === list, identity(f) === f];
});
attempt("remembered by the module", () => {
  const p: Point = { x: 1, y: 2 };
  const holder = new Holder(p);
  remember(p);
  remember(holder);
  return [remembers(p), remembers(holder), remembers(holder.point), remembers({ x: 1, y: 2 })];
});
attempt("the module scribbles on a typed object", () => {
  const p: Point = { x: 1, y: 2 };
  scribble(p);
  return [p.x, p.x + 1, Object.keys(p), JSON.stringify(p)];
});
attempt("the module scribbles on a field's object", () => {
  const holder = new Holder({ x: 1, y: 2 });
  scribble(holder.point);
  return [holder.point.x, JSON.stringify(holder)];
});
attempt("an instance of the module's class", () => {
  const t = new Tracked("first");
  return [t.isFirst(), t.secret(), Tracked.all[0] === t, t.name, Object.keys(t)];
});
attempt("an instance of a subclass without fields", () => {
  class Plain extends Tracked {}
  const t = new Plain("plain");
  return [Tracked.all[Tracked.all.length - 1] === t, t.secret(), t.name, Object.keys(t), t instanceof Tracked];
});
attempt("an instance of a subclass with a field", () => {
  class Extra extends Tracked {
    extra = 1;
  }
  const t = new Extra("extra");
  return [Tracked.all[Tracked.all.length - 1] === t, t.name, Object.keys(t), t instanceof Tracked, t.extra];
});
attempt("a private name of the base on a subclass with a field", () => {
  class Extra extends Tracked {
    extra = 1;
  }
  return new Extra("extra").secret();
});

// FILE: library.d.ts
export interface Point {
  x: number;
  y: number;
}
export declare function makePoint(): Point;
export declare function makeWide(): Point;
export declare function makeList(): number[];
export declare function makeLine(): { from: Point; to: Point };
export declare function isLast(value: unknown): boolean;
export declare function lastAsText(): string;
export declare function changeLast(): void;
export declare function identity<T>(value: T): T;
export declare function remember(value: object): void;
export declare function remembers(value: object): boolean;
export declare function scribble(value: Point): void;
export declare class Tracked {
  static all: Tracked[];
  name: string;
  constructor(name: string);
  secret(): number;
  isFirst(): boolean;
}

// FILE: library.js
let last = null;
const registry = new Set();

export function makePoint() {
  last = { x: 1, y: 2 };
  return last;
}

export function makeWide() {
  last = { z: 3, y: 2, x: 1 };
  return last;
}

export function makeList() {
  last = [1, 2];
  return last;
}

export function makeLine() {
  const p = { x: 1, y: 2 };
  last = { from: p, to: p };
  return last;
}

export function isLast(value) {
  return value === last;
}

export function lastAsText() {
  return JSON.stringify(last) + Object.keys(last).join();
}

export function changeLast() {
  if (Array.isArray(last)) last.push(100);
  else last.x = 100;
}

export function identity(value) {
  return value;
}

export function remember(value) {
  registry.add(value);
}

export function remembers(value) {
  return registry.has(value);
}

export function scribble(value) {
  value.x = 50;
  value.note = "scribbled";
}

export class Tracked {
  static all = [];
  #secret = 7;
  constructor(name) {
    this.name = name;
    Tracked.all.push(this);
  }
  secret() {
    return this.#secret;
  }
  isFirst() {
    return Tracked.all[0] === this;
  }
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [] }

// GENERATED: move Holder captured f Plain
// CHECK-LABEL: function {{*}}name="move"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = Integer integer=10
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_2]]}
// CHECK-NEXT: PropSet v0, v4 key="x"
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_4]]
// CHECK-NEXT: v6 = Convert v1 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v4, v6 key="point"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b4(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="captured"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] thisType={type=anything} results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=number site=[[w_6]]}] results=[{type=number site=[[w_7]]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_7]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Plain"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_9]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
