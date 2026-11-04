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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="area"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="area" calleeName="w.area"
// CHECK-NEXT: ReturnCall v2 casts=[{declared={type=number}}, {declared={type=number}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="border"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = PropGet v0 key="width"
// CHECK-NEXT: v3 = PropGet v0 key="height"
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = Mul v1, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="width"
// CHECK-NEXT: v2 = PropGet v0 key="height"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = Call v3, -, v0 calleeName="area"
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v6 = Call v5, -, v0 calleeName="border"
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="Widget"
// CHECK-NEXT: v9 = InstanceOf v0, v8
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="Widget"
// CHECK-NEXT: v12 = InstanceOf v0, v11
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="isWidget"
// CHECK-NEXT: v15 = ModuleNamespace module=[[m_7]]
// CHECK-NEXT: v16 = Call v14, v15, v0 calleeName="old.isWidget"
// CHECK-NEXT: v17 = Convert v16 declared={type=boolean} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="isWidget"
// CHECK-NEXT: v20 = ModuleNamespace module=[[m_9]]
// CHECK-NEXT: v21 = Call v19, v20, v0 calleeName="fresh.isWidget"
// CHECK-NEXT: v22 = Convert v21 declared={type=boolean} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v23 = Builtin builtin=Object
// CHECK-NEXT: v24 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v25 = Call v24, v23, v0 calleeName="Object.keys"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v27 = PropGet v26 key="join"
// CHECK-NEXT: v28 = Call v27, v26 calleeKey="join" calleeName="join"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v30 = NewArray v1, v2, v4, v6, v9, v12, v17, v22, v29 contents=anything
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="OldChild"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_10]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_10]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_11]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
