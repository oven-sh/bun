// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// Type roots bring in globals that do not exist.
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

function plusOne(n: number): number {
  return n + 1;
}

attempt("typeof each", () => [typeof BUILD_ID, typeof requestCount, typeof featureFlags, typeof track, typeof Widget, typeof Vendor, typeof Mode]);
attempt("a constant", () => BUILD_ID + "!");
attempt("a variable", () => requestCount + 1);
attempt("a store to a variable", () => {
  requestCount = 1;
  return "stored";
});
attempt("a var", () => featureFlags.fast);
attempt("a var through globalThis", () => [globalThis.featureFlags, typeof globalThis.featureFlags]);
attempt("a member of a var through globalThis", () => globalThis.featureFlags.level + 1);
attempt("a function", () => track("start") + 1);
attempt("a class", () => new Widget(1).grow());
attempt("a subclass", () => {
  class Wide extends Widget {}
  return new Wide(1).width;
});
attempt("instanceof", () => ({}) instanceof Widget);
attempt("a namespace", () => Vendor.version + 1);
attempt("an enum", () => Mode.On + 1);
attempt("a method of every list", () => [1, 2].last());
attempt("a method of every list, asked for", () => [typeof [1, 2].last, "last" in []]);
attempt("a method of every text", () => "a".shout());
attempt("a member of every number", () => [(5).doubled, (5).doubled + 1, plusOne((5).doubled)]);

Reflect.set(globalThis, "featureFlags", "no object");
Reflect.set(globalThis, "BUILD_ID", 7);
Reflect.set(globalThis, "requestCount", "many");
Reflect.set(globalThis, "track", (event: string) => event + "!");
Reflect.set(globalThis, "Widget", function () {
  return { width: "wide", grow: () => "grown" };
});
Reflect.set(globalThis, "Vendor", { version: "one" });
Reflect.set(globalThis, "Mode", { On: "on" });

attempt("now they exist: typeof each", () => [typeof BUILD_ID, typeof requestCount, typeof featureFlags, typeof track, typeof Widget, typeof Vendor, typeof Mode]);
attempt("now they exist: a constant", () => [BUILD_ID + "!", BUILD_ID.length]);
attempt("now they exist: a variable", () => [requestCount + 1, plusOne(requestCount)]);
attempt("now they exist: a store", () => {
  requestCount = 5;
  return [requestCount + 1, Reflect.get(globalThis, "requestCount")];
});
attempt("now they exist: a var", () => [featureFlags.fast, featureFlags.level, featureFlags.level + 1]);
attempt("now they exist: a function", () => [track("start"), track("start") + 1, plusOne(track("start"))]);
attempt("now they exist: a class", () => [new Widget(1).width, new Widget(1).width + 1, new Widget(1).grow(), new Widget(1) instanceof Widget]);
attempt("now they exist: a namespace", () => [Vendor.version + 1, plusOne(Vendor.version)]);
attempt("now they exist: a function of the namespace", () => Vendor.ping());
attempt("now they exist: an enum", () => [Mode.On, Mode.On + 1, Mode.Off, Mode.On === 1]);

export {};

// FILE: types/fake-globals/index.d.ts
declare const BUILD_ID: string;
declare let requestCount: number;
declare var featureFlags: { fast: boolean; level: number };
declare function track(event: string): number;
declare class Widget {
  width: number;
  constructor(width: number);
  grow(): number;
}
declare namespace Vendor {
  const version: number;
  function ping(): string;
}
declare enum Mode {
  Off,
  On,
}
interface Array<T> {
  last(): T;
}
interface String {
  shout(): string;
}
interface Number {
  readonly doubled: number;
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [ "bun-types", "fake-globals" ], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "typeRoots": [ "../../../../../packages", "./types" ] }, "files": [] }

// GENERATED: plusOne attempt Wide grow
// CHECK-LABEL: function {{*}}name="plusOne"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=" -> "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="show"
// CHECK-NEXT: v12 = Add v8, v11
// CHECK-NEXT: v13 = Call v6, v4, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v14 = CatchValue
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = String string=" threw "
// CHECK-NEXT: v21 = Add v0, v20
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="Error" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v25 = InstanceOf v14, v24
// CHECK-NEXT: v26 = ToBoolean v25
// CHECK-NEXT: Branch v26 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v27):
// CHECK-NEXT: v28 = PropGet v14 key="constructor"
// CHECK-NEXT: v29 = PropGet v28 key="name"
// CHECK-NEXT: Jump -> next b5(v29)
// CHECK-NEXT: b4(v30):
// CHECK-NEXT: v31 = TypeOf v14
// CHECK-NEXT: Jump -> next b5(v31)
// CHECK-NEXT: b5(v32):
// CHECK-NEXT: v33 = Add v21, v32
// CHECK-NEXT: v34 = Call v19, v17, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Wide"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_3]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="grow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="grown"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
