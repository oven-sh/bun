// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 2

// FILE: main.ts
// Two builds of one package share one declaration file.
import * as fresh from "widgets-new";
import * as old from "widgets-old";
import type { Widget } from "widgets-old";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
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

function area(w: Widget): number {
  return w.area();
}

function border(w: Widget): number {
  return 2 * (w.width + w.height);
}

function describe(w: Widget): unknown {
  return [w.width, w.height, area(w), border(w), w instanceof old.Widget, w instanceof fresh.Widget, old.isWidget(w), fresh.isWidget(w), Object.keys(w).join()];
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += area(old.make(i, 2)) + border(old.make(i, 2));
console.log("2000 rounds with the old build: " + warm);

attempt("the old build", () => describe(old.make(2, 3)));
attempt("the new build", () => describe(fresh.make(2, 3)));
attempt("constructed here", () => [describe(new old.Widget(2, 3)), describe(new fresh.Widget(2, 3))]);
attempt("a method of one build on an instance of the other", () => old.Widget.prototype.area.call(fresh.make(2, 3)));
attempt("and the other way round", () => fresh.Widget.prototype.area.call(old.make(2, 3)));
attempt("static members", () => [typeof old.Widget.count, typeof fresh.Widget.count, fresh.Widget.count + 1]);
attempt("in one list", () => {
  const widgets: Widget[] = [old.make(1, 2), fresh.make(3, 4), old.make(5, 6)];
  let total = 0;
  for (const w of widgets) total += w.area() + w.width;
  return total;
});
attempt("subclasses of both", () => {
  class OldChild extends old.Widget {
    depth = 1;
  }
  class NewChild extends fresh.Widget {
    depth = 1;
  }
  return [describe(new OldChild(2, 3)), describe(new NewChild(2, 3))];
});
attempt("the old build without new", () => Reflect.apply(old.Widget, undefined, [1, 2]));
attempt("the new build without new", () => Reflect.apply(fresh.Widget, undefined, [1, 2]));

// FILE: packages/new/index.d.ts
export * from "../types/widget";

// FILE: packages/new/index.js
export class Widget {
  #area;
  static count = "many";
  constructor(width, height) {
    this.height = height;
    this.width = width;
    this.#area = width * height;
  }
  area() {
    return this.#area;
  }
}

export function make(width, height) {
  return new Widget(width, height);
}

export function isWidget(value) {
  return value instanceof Widget;
}

// FILE: packages/old/index.d.ts
export * from "../types/widget";

// FILE: packages/old/index.js
export function Widget(width, height) {
  this.width = width;
  this.height = height;
  Widget.count++;
}
Widget.count = 0;
Widget.prototype.area = function () {
  return this.width * this.height;
};

export function make(width, height) {
  return new Widget(width, height);
}

export function isWidget(value) {
  return value instanceof Widget;
}

// FILE: packages/types/widget.d.ts
export declare class Widget {
  width: number;
  height: number;
  constructor(width: number, height: number);
  area(): number;
  static count: number;
}
export declare function make(width: number, height: number): Widget;
export declare function isWidget(value: unknown): value is Widget;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "paths": { "widgets-old": [ "./packages/old/index" ], "widgets-new": [ "./packages/new/index" ] } }, "files": [] }

// GENERATED: area border describe OldChild
// CHECK-LABEL: function {{*}}name="area"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="area"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="area" calleeName="w.area"
// CHECK-NEXT: ReturnCall v2 casts=[{declared={type=number site=[[w_3]]}}, {declared={type=number site=[[w_2]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="border"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=number site=[[w_4]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = PropGet v0 key="width"
// CHECK-NEXT: v3 = PropGet v0 key="height"
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = Mul v1, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="width"
// CHECK-NEXT: v2 = PropGet v0 key="height"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v4 = Call v3, -, v0 calleeName="area"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_6]]}
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v7 = Call v6, -, v0 calleeName="border"
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_8]]}
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="Widget"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v12 = InstanceOf v0, v11 writtenExpression="w instanceof old.Widget"
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="Widget"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v16 = InstanceOf v0, v15 writtenExpression="w instanceof fresh.Widget"
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="isWidget"
// CHECK-NEXT: v19 = ModuleNamespace module=[[m_13]]
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v21 = Call v18, v20, v0 calleeName="old.isWidget"
// CHECK-NEXT: v22 = Convert v21 declared={type=boolean site=[[w_14]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v24 = CheckInitialized v23 name="isWidget"
// CHECK-NEXT: v25 = ModuleNamespace module=[[m_16]]
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v27 = Call v24, v26, v0 calleeName="fresh.isWidget"
// CHECK-NEXT: v28 = Convert v27 declared={type=boolean site=[[w_17]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v29 = Builtin builtin=Object
// CHECK-NEXT: v30 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v31 = Call v30, v29, v0 calleeName="Object.keys"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|Array<undefined|null|string> site=[[w_18]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v33 = PropGet v32 key="join"
// CHECK-NEXT: v34 = Call v33, v32 calleeKey="join" calleeName="join"
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v36 = NewArray v1, v2, v5, v8, v12, v16, v22, v28, v35 contents=anything
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="OldChild"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_19]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_19]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_20]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
