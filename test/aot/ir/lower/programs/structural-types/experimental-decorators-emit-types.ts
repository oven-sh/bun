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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Array
// CHECK-NEXT: v2 = Builtin builtin=ArrayIsArray
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Array.isArray"
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean site=[[w_3]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = ToBoolean v4
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = String string="["
// CHECK-NEXT: v8 = Convert v0 declared={type=undefined|null|Array} illTypedCause=Assertion
// CHECK-NEXT: v9 = PropGet v8 key="map"
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v11 = Call v9, v8, v10 calleeKey="map" calleeName="value.map"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<undefined|null|string> site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v13 = PropGet v12 key="join"
// CHECK-NEXT: v14 = String string=" "
// CHECK-NEXT: v15 = Call v13, v12, v14 calleeKey="join" calleeName="join"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v17 = Add v7, v16
// CHECK-NEXT: v18 = String string="]"
// CHECK-NEXT: v19 = Add v17, v18
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v20
// CHECK-NEXT: b4(v21):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v22 = TypeTest v0 testedType=function
// CHECK-NEXT: Branch v22 -> taken b6(| 0), notTaken b9(| 0)
// CHECK-NEXT: b6(v23):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|function} illTypedCause=Assertion
// CHECK-NEXT: v25 = PropGet v24 key="name"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|string site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: Return v26
// CHECK-NEXT: b9(v27):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v28 = Builtin builtin=String
// CHECK-NEXT: v29 = Call v28, -, v27 calleeName="String"
// CHECK-NEXT: ReturnCall v29 casts=[{declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Everything"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=number site=[[w_8]]}, {type=undefined|null|boolean|number|string|symbol|bigint|[[L_9]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string site=[[w_11]] flags=[OmitsNull]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: anything, v1: number, v2: undefined|null|boolean|number|string|symbol|bigint|[[L_9]], v3: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = GetConstructPrototype v0 layout=[[L_13]]
// CHECK-NEXT: v5 = NewObject v4 layout=[[L_13]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_13]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = CallDirect v6 function=[[f_14]]
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b4(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4(v6)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="method"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasRestParameter, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[L_16]] site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}, {type=Array<number> site=[[w_18]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_19]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[L_16]], v2: Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Boolean boolean=true
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean site=[[w_19]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="later"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, HasThis, IsChecked, HasExplicitName] thisType={type=[[L_13]] site=[[w_20]]} results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_13]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_21]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_21]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
