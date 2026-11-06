// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Skip lib check hides a broken declaration file.
import { count, limit, list, make, nope, options, pair, sound, step, Widget } from "broken";

interface Point {
  x: number;
  y: number;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function plusOne(n: number): number {
  return n + 1;
}

function sum(p: Point): number {
  return p.x + p.y;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const n: number = make("number");
  const p: Point = make("point");
  warm += plusOne(n) + sum(p) + sound(i);
}
console.log("2000 honest rounds: " + warm);

for (const kind of ["number", "text", "nothing", "point", "texts", "list", "unknown"]) {
  attempt("a result of a type that does not exist, " + kind + ", as a number", () => {
    const n: number = make(kind);
    return [n + 1, plusOne(n), typeof n];
  });
  attempt("a result of a type that does not exist, " + kind + ", as a point", () => {
    const p: Point = make(kind);
    return [p.x, sum(p)];
  });
}
attempt("a constant of a misspelled type", () => {
  const n: number = limit;
  return [n + 1, plusOne(limit), typeof limit];
});
attempt("a tuple", () => {
  const [a, b] = pair();
  const n: number = b;
  return [a + 1, plusOne(a), n + 1];
});
attempt("a type from a module that is not there", () => {
  const n: number = nope();
  return n + 1;
});
attempt("a list", () => {
  const numbers: number[] = list();
  return numbers.map(plusOne);
});
attempt("a function", () => {
  const f: (n: number) => number = step();
  return [f(1), f(1) + 1];
});
attempt("an interface with a parent that is not there", () => [options().size, options().size + 1, plusOne(options().size), Object.keys(options()).join()]);
attempt("a class with a parent that is not there", () => {
  const widget = new Widget();
  return [widget.width, widget.width + 1, widget.grow(), plusOne(widget.grow()), Object.keys(widget).join()];
});
attempt("a subclass of it", () => {
  class Wide extends Widget {
    extra = 1;
    both(): number {
      return this.width + this.extra;
    }
  }
  const wide = new Wide();
  return [wide.both(), Object.keys(wide).join()];
});
attempt("a constant declared twice", () => [typeof count, show(count)]);
attempt("what is declared well", () => [sound(1), plusOne(sound(1))]);

// FILE: packages/broken/index.d.ts
import { Nope } from "./nowhere";

export declare function make(kind: string): Missing;
export declare const limit: numbr;
export declare function pair(): [number, Gone<string>];
export declare function nope(): Nope;
export declare function list(): Array<Absent>;
export declare function step(): (n: number) => Lost;
export interface Options extends NotThere {
  size: number;
}
export declare function options(): Options;
export declare class Widget extends MissingBase {
  width: number;
  grow(): number;
}
export declare const count: number;
export declare const count: string;
export declare function sound(n: number): number;

// FILE: packages/broken/index.js
export function make(kind) {
  return { number: 3, text: "3", nothing: null, point: { x: 1, y: 2 }, texts: { y: "2", x: "1" }, list: [1, 2] }[kind];
}

export const limit = "10";

export function pair() {
  return ["1", 2];
}

export function nope() {
  return "nope";
}

export function list() {
  return [1, "2", null];
}

export function step() {
  return n => n + "!";
}

export function options() {
  return { size: "large", extra: 1 };
}

export class Widget {
  width = "wide";
  grow() {
    return this.width + 1;
  }
}

export const count = [1];

export function sound(n) {
  return n + 1;
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "skipLibCheck": true, "paths": { "broken": [ "./packages/broken/index" ] } }, "files": [] }

// GENERATED: plusOne attempt Wide both
// CHECK-LABEL: function {{*}}name="plusOne"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=number site=[[w_2]]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=" -> "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="show"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = Add v8, v12
// CHECK-NEXT: v14 = Call v6, v4, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v15 = CatchValue
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string=" threw "
// CHECK-NEXT: v22 = Add v0, v21
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="Error" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v26 = InstanceOf v15, v25 writtenExpression="error instanceof Error"
// CHECK-NEXT: v27 = ToBoolean v26
// CHECK-NEXT: Branch v27 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v28):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v29 = Convert v15 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v29 key="constructor"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|function site=[[w_9]]} illTypedCause=Assertion
// CHECK-NEXT: v32 = PropGet v31 key="name"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string site=[[w_9]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b9(v33)
// CHECK-NEXT: b7(v34):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v35 = TypeOf v15
// CHECK-NEXT: Jump -> next b9(v35)
// CHECK-NEXT: b9(v36):
// CHECK-NEXT: v37 = Add v22, v36
// CHECK-NEXT: v38 = Call v20, v18, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Wide"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_10]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_10]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_11]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="both"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_10]] site=[[w_12]]} results=[{type=number site=[[w_13]]}] {
// CHECK-NEXT: b0(v0: [[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="width"
// CHECK-NEXT: v2 = PropGet v0 key="extra"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_13]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
