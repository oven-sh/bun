// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// Experimental decorators emit the types of members as metadata.
export {};

declare global {
  namespace Reflect {
    function metadata(key: string, value: unknown): (target: object, member?: string | symbol) => void;
  }
}

const seen: string[] = [];

function nameOf(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(nameOf).join(" ") + "]";
  return typeof value === "function" ? value.name : String(value);
}

Reflect.metadata = (key, value) => (target, member) => {
  seen.push(String(member ?? "the class") + " " + key + " " + nameOf(value));
};

function noted(target: object, member?: string | symbol, extra?: unknown): void {}

class Dog {}
interface Shape {
  sides: number;
}
enum Color {
  Red,
}
enum Word {
  Yes = "yes",
}

@noted
class Everything<T> {
  @noted a: number = 1;
  @noted b: string = "s";
  @noted c: boolean = true;
  @noted d: Dog = new Dog();
  @noted e: Shape = { sides: 1 };
  @noted f: number | string = 1;
  @noted g: number[] = [];
  @noted h: () => void = () => {};
  @noted i: Color = Color.Red;
  @noted j: Word = Word.Yes;
  @noted k: unknown = 1;
  @noted l: bigint = 1n;
  @noted m: symbol = Symbol();
  @noted n: [number, string] = [1, "s"];
  @noted o: "on" | "off" = "on";
  @noted p?: number;
  @noted q: T | undefined = undefined;
  @noted r: Promise<number> = Promise.resolve(1);
  @noted s: null = null;
  @noted t: number | undefined = undefined;
  @noted u: Map<string, number> = new Map();
  @noted v: object = {};
  @noted w: 5 = 5;
  constructor(first: number, second: Dog, third?: string) {}
  @noted
  method(first: string, second: Shape, ...rest: number[]): boolean {
    return true;
  }
  @noted
  async later(): Promise<void> {}
  @noted
  get computed(): number {
    return 1;
  }
}

for (const line of seen) console.log(line);
console.log("keys " + Object.keys(new Everything<number>(1, new Dog())).join(""));

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "typeRoots": [ "../../../../../packages" ], "types": [ "bun-types" ], "noEmit": true, "strict": true, "experimentalDecorators": true, "emitDecoratorMetadata": true } }

// GENERATED: nameOf Everything method later computed
// CHECK-LABEL: function {{*}}name="nameOf"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Builtin builtin=ArrayIsArray
// CHECK-NEXT: v2 = TypeTest v0 testedType=Array
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: Jump -> next b3(v3)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = NarrowByTest v0, v4
// CHECK-NEXT: v6 = Builtin builtin=Array
// CHECK-NEXT: v7 = Builtin builtin=ArrayIsArray
// CHECK-NEXT: v8 = Call v7, v6, v5 calleeName="Array.isArray"
// CHECK-NEXT: v9 = Convert v8 declared={type=boolean} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v10 = ToBoolean v9
// CHECK-NEXT: Branch v10 -> taken b3(v4), notTaken b4(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: v12 = NarrowByTest v0, v11
// CHECK-NEXT: v13 = String string="["
// CHECK-NEXT: v14 = PropGet v12 key="map"
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v16 = Call v14, v12, v15 calleeKey="map" calleeName="value.map"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v18 = PropGet v17 key="join"
// CHECK-NEXT: v19 = String string=" "
// CHECK-NEXT: v20 = Call v18, v17, v19 calleeKey="join" calleeName="join"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v22 = Add v13, v21
// CHECK-NEXT: v23 = String string="]"
// CHECK-NEXT: v24 = Add v22, v23
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v25
// CHECK-NEXT: b4(v26):
// CHECK-NEXT: v27 = TypeTest v5 testedType=function
// CHECK-NEXT: Branch v27 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v28):
// CHECK-NEXT: v29 = NarrowByTest v0, v28
// CHECK-NEXT: v30 = PropGet v29 key="name"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v31
// CHECK-NEXT: b6(v32):
// CHECK-NEXT: v33 = NarrowByTest v0, v32
// CHECK-NEXT: v34 = Builtin builtin=String
// CHECK-NEXT: v35 = Call v34, -, v33 calleeName="String"
// CHECK-NEXT: ReturnCall v35 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Everything"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=number}, {type=undefined|null|boolean|number|string|symbol|bigint|[[L_2]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string flags=[OmitsNull]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: number, v2: undefined|null|boolean|number|string|symbol|bigint|[[L_2]], v3: undefined|null|string):
// CHECK-NEXT: v4 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v5 = NewObject v4 layout=[[L_3]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_3]]}
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Convert v7 declared={type=number}
// CHECK-NEXT: PropSet v6, v8 key="a"
// CHECK-NEXT: v10 = String string="s"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v6, v11 key="b"
// CHECK-NEXT: v13 = Boolean boolean=true
// CHECK-NEXT: v14 = Convert v13 declared={type=boolean}
// CHECK-NEXT: PropSet v6, v14 key="c"
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="Dog"
// CHECK-NEXT: v18 = Construct v17 calleeName="Dog"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|boolean|number|string|symbol|bigint|[[L_2]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: PropSet v6, v19 key="d"
// CHECK-NEXT: v21 = Data data=[[d_5]]
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|[[L_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v6, v22 key="e"
// CHECK-NEXT: v24 = Integer integer=1
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|number|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v6, v25 key="f"
// CHECK-NEXT: v27 = Data data=[[d_7]]
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|Array<number> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v6, v28 key="g"
// CHECK-NEXT: v30 = NewClosure function=[[f_8]]
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|[[f_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v6, v31 key="h"
// CHECK-NEXT: v33 = Integer
// CHECK-NEXT: v34 = Convert v33 declared={type=0}
// CHECK-NEXT: PropSet v6, v34 key="i"
// CHECK-NEXT: v36 = String string="yes"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|"yes" flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v6, v37 key="j"
// CHECK-NEXT: v39 = Integer integer=1
// CHECK-NEXT: PropSet v6, v39 key="k"
// CHECK-NEXT: v41 = BigInt digits="1"
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|null|bigint flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v6, v42 key="l"
// CHECK-NEXT: v44 = Builtin builtin=Symbol
// CHECK-NEXT: v45 = Call v44 calleeName="Symbol" callNumber=8
// CHECK-NEXT: v46 = Convert v45 declared={type=undefined|null|symbol flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: PropSet v6, v46 key="m"
// CHECK-NEXT: v48 = Data data=[[d_10]]
// CHECK-NEXT: v49 = Convert v48 declared={type=undefined|null|Array<undefined|null|number|string> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v6, v49 key="n"
// CHECK-NEXT: v51 = String string="on"
// CHECK-NEXT: v52 = Convert v51 declared={type=undefined|null|"off"|"on" flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v6, v52 key="o"
// CHECK-NEXT: v54 = Undefined
// CHECK-NEXT: PropSet v6, v54 key="q"
// CHECK-NEXT: v56 = Builtin builtin=GlobalThis
// CHECK-NEXT: v57 = PropGet v56 key="Promise" [isFreeName]
// CHECK-NEXT: v58 = Convert v57 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v59 = PropGet v58 key="resolve"
// CHECK-NEXT: v60 = Convert v59 declared={type=builtin(PromiseResolve) flags=[IsExpected]}
// CHECK-NEXT: v61 = Integer integer=1
// CHECK-NEXT: v62 = Call v60, v58, v61 calleeKey="resolve" calleeName="Promise.resolve"
// CHECK-NEXT: v63 = Convert v62 declared={type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v6, v63 key="r"
// CHECK-NEXT: v65 = Null
// CHECK-NEXT: v66 = Convert v65 declared={type=null}
// CHECK-NEXT: PropSet v6, v66 key="s"
// CHECK-NEXT: v68 = Undefined
// CHECK-NEXT: v69 = Convert v68 declared={type=undefined|number}
// CHECK-NEXT: PropSet v6, v69 key="t"
// CHECK-NEXT: v71 = Builtin builtin=Map
// CHECK-NEXT: v72 = Construct v71 calleeName="Map"
// CHECK-NEXT: v73 = Convert v72 declared={type=undefined|null|Map flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v74 = Convert v73 declared={type=undefined|null|Map<undefined|null|string, number> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v6, v74 key="u"
// CHECK-NEXT: v76 = Data data=[[d_11]]
// CHECK-NEXT: v77 = Convert v76 declared={type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v6, v77 key="v"
// CHECK-NEXT: v79 = Integer integer=5
// CHECK-NEXT: v80 = Convert v79 declared={type=5}
// CHECK-NEXT: PropSet v6, v80 key="w"
// CHECK-NEXT: v82 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="method"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[HasRestParameter, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[L_6]] flags=[OmitsNull, OmitsUndefined]}, {type=Array<number> flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[L_6]], v2: Array<number>):
// CHECK-NEXT: v3 = Boolean boolean=true
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="later"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[IsAsync, HasThis, IsChecked, HasExplicitName] thisType={type=[[L_3]]} results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_3]]):
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
