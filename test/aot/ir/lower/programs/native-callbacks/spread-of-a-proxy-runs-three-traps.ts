// RUN: lower
// OPTIONS: builtin-modules

// Sources of a spread: spreading a proxy runs ownKeys, getOwnPropertyDescriptor and get of a handler that is a class instance, with symbols among the keys; the program's own calls pass strings.
let total = 0;

const tag = Symbol("tag");
type Target = Record<string | symbol, number>;

class Handler implements ProxyHandler<Target> {
  ownKeys(target: Target): (string | symbol)[] {
    total += 1;
    return [...Reflect.ownKeys(target), "ghost"];
  }
  getOwnPropertyDescriptor(target: Target, key: string): PropertyDescriptor | undefined {
    total += typeof key === "string" ? 100 : 10000;
    return key === "ghost" ? { value: 0, enumerable: true, configurable: true } : Reflect.getOwnPropertyDescriptor(target, key);
  }
  get(target: Target, key: string): number | string {
    total += typeof key === "string" ? 1000000 : 100000000;
    return typeof key === "string" ? key.length : "symbol";
  }
}

const handler = new Handler();
const target: Target = { a: 1, bb: 2, [tag]: 3 };
handler.get(target, "own");
handler.getOwnPropertyDescriptor(target, "a");
const proxy = new Proxy(target, handler);
const copy = { ...proxy };
const assigned = Object.assign({}, proxy);
const { a, ...rest } = proxy;
console.log(total, JSON.stringify(copy), String(copy[tag]), Object.keys(assigned).join(), a, Object.keys(rest).join());

// GENERATED: Handler ownKeys getOwnPropertyDescriptor
// CHECK-LABEL: function {{*}}name="Handler"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ownKeys"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array<undefined|null|string|symbol> flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="total"
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number}
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="total"
// CHECK-NEXT: PutModuleVariable v5 variable=[[g_3]]
// CHECK-NEXT: v9 = NewArray contents=undefined|null|string|symbol
// CHECK-NEXT: v10 = Builtin builtin=Reflect
// CHECK-NEXT: v11 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v12 = Call v11, v10, v0 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array<undefined|null|string|symbol> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: AppendSpread v9, v13
// CHECK-NEXT: v15 = String string="ghost"
// CHECK-NEXT: AppendElement v9, v15
// CHECK-NEXT: v17 = Convert v9 declared={type=undefined|null|Array<undefined|null|string|symbol> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="getOwnPropertyDescriptor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|string):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="total"
// CHECK-NEXT: v4 = TypeTest v1 testedType=string
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = Integer integer=100
// CHECK-NEXT: Jump -> next b3(v6)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = Integer integer=10000
// CHECK-NEXT: Jump -> next b3(v8)
// CHECK-NEXT: b3(v9):
// CHECK-NEXT: v10 = Add v3, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=number}
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="total"
// CHECK-NEXT: PutModuleVariable v11 variable=[[g_3]]
// CHECK-NEXT: v15 = String string="ghost"
// CHECK-NEXT: v16 = StrictEq v1, v15
// CHECK-NEXT: Branch v16 -> taken b4(), notTaken b5()
// CHECK-NEXT: b4():
// CHECK-NEXT: v17 = Data data=[[d_6]]
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: b5():
// CHECK-NEXT: v19 = Builtin builtin=Reflect
// CHECK-NEXT: v20 = Builtin builtin=ReflectGetOwnPropertyDescriptor
// CHECK-NEXT: v21 = Call v20, v19, v0, v1 calleeName="Reflect.getOwnPropertyDescriptor"
// CHECK-NEXT: ReturnCall v21 casts=[{declared={type=undefined|null|number|string|symbol|bigint|[[L_7]] flags=[IsExpected]}}, {declared={type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}}]
// CHECK-NEXT: }
