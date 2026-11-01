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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_4]]):
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
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="show"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
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
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|function site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: v32 = PropGet v31 key="name"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string site=[[w_8]]} illTypedCause=Assertion
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
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_9]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="grow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="grown"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
