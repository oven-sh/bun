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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ownKeys"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array<undefined|null|string|symbol> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="total"
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_6]]}
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="total"
// CHECK-NEXT: PutModuleVariable v5 variable=[[g_5]]
// CHECK-NEXT: v9 = NewArray contents=undefined|null|string|symbol
// CHECK-NEXT: v10 = Builtin builtin=Reflect
// CHECK-NEXT: v11 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v12 = Call v11, v10, v0 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array<undefined|null|string|symbol> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: AppendSpread v9, v13
// CHECK-NEXT: v15 = String string="ghost"
// CHECK-NEXT: AppendElement v9, v15
// CHECK-NEXT: v17 = Convert v9 declared={type=undefined|null|Array<undefined|null|string|symbol> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="getOwnPropertyDescriptor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|number|string|symbol|bigint|[[L_10]] flags=[IsExpected]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="total"
// CHECK-NEXT: v4 = TypeTest v1 testedType=string
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = Integer integer=100
// CHECK-NEXT: Jump -> next b6(v6, v5)
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v8 = Integer integer=10000
// CHECK-NEXT: Jump -> next b6(v8, v7)
// CHECK-NEXT: b6(v9, v10: undefined|null|string):
// CHECK-NEXT: v11 = Add v3, v9
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_6]]}
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="total"
// CHECK-NEXT: PutModuleVariable v12 variable=[[g_5]]
// CHECK-NEXT: v16 = String string="ghost"
// CHECK-NEXT: v17 = StrictEq v10, v16
// CHECK-NEXT: Branch v17 -> taken b7(| 0), notTaken b10(| 0)
// CHECK-NEXT: b7(v18):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v19 = Data data=[[d_12]]
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|number|string|symbol|bigint|[[L_10]] flags=[IsExpected]}
// CHECK-NEXT: Return v20
// CHECK-NEXT: b10(v21):
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: v22 = Builtin builtin=Reflect
// CHECK-NEXT: v23 = Builtin builtin=ReflectGetOwnPropertyDescriptor
// CHECK-NEXT: v24 = Call v23, v22, v0, v21 calleeName="Reflect.getOwnPropertyDescriptor"
// CHECK-NEXT: ReturnCall v24 casts=[{declared={type=undefined|null|number|string|symbol|bigint|[[L_13]] flags=[IsExpected]}}, {declared={type=undefined|null|number|string|symbol|bigint|[[L_10]] flags=[IsExpected]}}]
// CHECK-NEXT: }
