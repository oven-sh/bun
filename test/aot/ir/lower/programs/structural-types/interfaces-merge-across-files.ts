// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 5
// STATISTIC: SourceFilesInferred = 1

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

// GENERATED: size attempt describe
// CHECK-LABEL: function {{*}}name="size"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="length"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_3]]} illTypedCause=Assertion
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_8]]}
// CHECK-NEXT: PropSet v3, v5 key="length"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="console" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="log"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v12 = String string="->"
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v14 = Call v1 calleeName="run"
// CHECK-NEXT: v15 = Call v13, -, v14 calleeName="show"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="log"
// CHECK-NEXT: v19 = PropGet v18 key="join"
// CHECK-NEXT: v20 = String string=" "
// CHECK-NEXT: v21 = Call v19, v18, v20 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v23 = Call v11, v9, v0, v12, v16, v22 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v24 = CatchValue
// CHECK-NEXT: v25 = Builtin builtin=GlobalThis
// CHECK-NEXT: v26 = PropGet v25 key="console" [isFreeName]
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v27 key="log"
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v30 = String string="threw"
// CHECK-NEXT: v31 = Builtin builtin=GlobalThis
// CHECK-NEXT: v32 = PropGet v31 key="Error" [isFreeName]
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v34 = InstanceOf v24, v33 writtenExpression="error instanceof Error"
// CHECK-NEXT: v35 = ToBoolean v34
// CHECK-NEXT: Branch v35 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v36):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v37 = Convert v24 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v38 = PropGet v37 key="constructor"
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|function site=[[w_12]]} illTypedCause=Assertion
// CHECK-NEXT: v40 = PropGet v39 key="name"
// CHECK-NEXT: v41 = Convert v40 declared={type=undefined|null|string site=[[w_12]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b9(v41)
// CHECK-NEXT: b7(v42):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v43 = TypeOf v24
// CHECK-NEXT: Jump -> next b9(v43)
// CHECK-NEXT: b9(v44):
// CHECK-NEXT: v45 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v46 = CheckInitialized v45 name="log"
// CHECK-NEXT: v47 = PropGet v46 key="join"
// CHECK-NEXT: v48 = String string=" "
// CHECK-NEXT: v49 = Call v47, v46, v48 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v50 = Convert v49 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v51 = Call v29, v27, v0, v30, v44, v50 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v52 = Undefined
// CHECK-NEXT: Return v52
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_14]] site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_14]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="name"
// CHECK-NEXT: v2 = String string=":"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = PropGet v0 key="depth"
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: v7 = Add v3, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
