// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// A project with exact optional property types.
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

interface Options {
  size?: number;
  label?: string;
  inner?: { n: number };
}

function sizeIfThere(o: Options): number {
  return "size" in o ? o.size + 1 : -1;
}

function labelIfOwn(o: Options): number {
  if (Object.hasOwn(o, "label") && "label" in o) return o.label.length;
  return -1;
}

function innerIfThere(o: Options): number {
  return "inner" in o ? o.inner.n : -1;
}

function sizeOrDefault(o: Options): number {
  return (o.size ?? 10) + 1;
}

function merged(a: Options, b: Options): Options {
  return { ...a, ...b };
}

function described(o: Options): string {
  return Object.keys(o).join() + "|" + JSON.stringify(o) + "|" + ("size" in o);
}

attempt("honest", () => [sizeIfThere({ size: 1 }), sizeIfThere({}), labelIfOwn({ label: "ab" }), labelIfOwn({}), innerIfThere({ inner: { n: 5 } }), innerIfThere({}), sizeOrDefault({}), sizeOrDefault({ size: 1 }), described(merged({ size: 1 }, { label: "l" }))]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += sizeIfThere(i & 1 ? { size: i } : {}) + labelIfOwn({ label: "ab" }) + innerIfThere({ inner: { n: i } }) + sizeOrDefault({});
console.log("2000 honest rounds", warm);

function withUndefined(): Options {
  const o: Options = {};
  Object.assign(o, { size: undefined, label: undefined, inner: undefined });
  return o;
}

function definedAsUndefined(): Options {
  const o: Options = {};
  Object.defineProperty(o, "size", { value: undefined, enumerable: true, writable: true, configurable: true });
  return o;
}

function fromEntries(): Options {
  const o: Options = { size: 1, label: "l", inner: { n: 1 } };
  for (const key of Object.keys(o)) Reflect.set(o, key, undefined);
  return o;
}

function inherited(): Options {
  class Base {
    size = 7;
  }
  class Derived extends Base {}
  return new Derived();
}

function onThePrototype(): Options {
  class WithGetter {
    get size(): number {
      log.push("get-size");
      return 8;
    }
  }
  return new WithGetter();
}

for (const [name, make] of [["assigned undefined", withUndefined], ["defined as undefined", definedAsUndefined], ["set to undefined by Reflect.set", fromEntries], ["a field of a base class", inherited], ["a getter of the prototype", onThePrototype]] satisfies [string, () => Options][]) {
  attempt(name + ": sizeIfThere", () => sizeIfThere(make()));
  attempt(name + ": labelIfOwn", () => labelIfOwn(make()));
  attempt(name + ": innerIfThere", () => innerIfThere(make()));
  attempt(name + ": sizeOrDefault", () => sizeOrDefault(make()));
  attempt(name + ": described", () => described(make()));
  attempt(name + ": merged over a full one", () => described(merged({ size: 1, label: "l" }, make())));
  attempt(name + ": merged, then read", () => sizeIfThere(merged({ size: 1 }, make())));
}

attempt("deleted after the test", () => {
  const o: Options = { size: 1 };
  const drop = () => {
    delete o.size;
  };
  if ("size" in o) {
    drop();
    return o.size + 1;
  }
  return -1;
});
attempt("a type that allows undefined beside one that does not", () => {
  const loose: { size?: number | undefined } = { size: undefined };
  const read = (o: { size?: number | undefined }): string => ("size" in o ? "there " + o.size : "absent");
  return [read(loose), read({}), read({ size: 1 })];
});
attempt("honest again", () => [sizeIfThere({ size: 1 }), sizeIfThere({}), labelIfOwn({ label: "ab" }), innerIfThere({}), sizeOrDefault({})]);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "exactOptionalPropertyTypes": true }, "files": [] }

// GENERATED: definedAsUndefined fromEntries onThePrototype Derived drop
// CHECK-LABEL: function {{*}}name="definedAsUndefined"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_3]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v4 = String string="size"
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: v6 = Boolean boolean=true
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|boolean}
// CHECK-NEXT: v8 = Boolean boolean=true
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|boolean}
// CHECK-NEXT: v10 = Boolean boolean=true
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|boolean}
// CHECK-NEXT: v12 = NewObject -, v5, v7, v9, v11 layout=[[L_4]] fields=[4, 1, 5, 0]
// CHECK-NEXT: v13 = FinishObject v12
// CHECK-NEXT: v14 = Call v3, v2, v1, v4, v13 calleeName="Object.defineProperty"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fromEntries"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_6]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v4 = Call v3, v2, v1 calleeName="Object.keys"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array<undefined|null|string> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = IteratorOpen v5
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = IteratorResume v6
// CHECK-NEXT: v9 = ResultAt v8
// CHECK-NEXT: v10 = ResultAt v8 index=1
// CHECK-NEXT: Branch v9 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v1
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v12 = Builtin builtin=Reflect
// CHECK-NEXT: v13 = Builtin builtin=ReflectSet
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: v15 = Call v13, v12, v1, v11, v14 calleeName="Reflect.set"
// CHECK-NEXT: v16 = Convert v15 declared={type=boolean site=[[w_9]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6() role=IterationCleanup subject=v6:
// CHECK-NEXT: v17 = CatchException
// CHECK-NEXT: IteratorClose v6 completion=Throw
// CHECK-NEXT: Rethrow v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="onThePrototype"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_11]]
// CHECK-NEXT: v1 = NewClass v0 layout=[[L_12]]
// CHECK-NEXT: v2 = NewClosure function=[[f_13]]
// CHECK-NEXT: DefineMethod v1, v2 layout=[[L_12]] methodKind=Getter key="size"
// CHECK-NEXT: v4 = FinishClass v1 layout=[[L_12]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[f_11]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = Convert v4 declared={type=[[f_11]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = Construct v6 calleeName="WithGetter"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_12]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Derived"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_15]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_16]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_16]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="drop"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropDelete v0 key="size"
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
