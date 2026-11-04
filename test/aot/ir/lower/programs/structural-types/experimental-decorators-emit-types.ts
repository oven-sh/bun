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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=number}, {type=undefined|null|boolean|number|string|symbol|bigint|[[L_2]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string flags=[OmitsNull]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: number, v2: undefined|null|boolean|number|string|symbol|bigint|[[L_2]], v3: undefined|null|string):
// CHECK-NEXT: v4 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v5 = NewObject v4 layout=[[L_3]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_3]]}
// CHECK-NEXT: v7 = CallDirect v6 function=[[f_4]]
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b1(| 0), notTaken b2(v6)
// CHECK-NEXT: b1(v10):
// CHECK-NEXT: Jump -> next b2(v10)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="method"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasRestParameter, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[L_5]] flags=[OmitsNull, OmitsUndefined]}, {type=Array<number> flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[L_5]], v2: Array<number>):
// CHECK-NEXT: v3 = Boolean boolean=true
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="later"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, HasThis, IsChecked, HasExplicitName] thisType={type=[[L_3]]} results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_3]]):
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
