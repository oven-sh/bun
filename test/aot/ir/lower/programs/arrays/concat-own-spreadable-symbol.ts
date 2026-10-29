// RUN: lower
// OPTIONS: builtin-modules

// `concat` spreads an object that compiled code created when its own `Symbol.isConcatSpreadable` is true, whether the literal has the symbol, a store adds it or a definition adds it, and appends the object as one element otherwise.
type Items = { length: number; 0: string; 1: string; [Symbol.isConcatSpreadable]?: boolean };
type Plain = { length: number; 0: string; 1: string };

function concat(value: unknown): string {
  const result = (["head"] as unknown[]).concat(value);
  return `${result.length} ${JSON.stringify(result)}`;
}
function concatAsReceiver(value: unknown): string {
  const result: unknown[] = Array.prototype.concat.call(value, "tail");
  return `${result.length} ${JSON.stringify(result)}`;
}
function show(label: string, value: unknown): void {
  console.log(`${label}: ${concat(value)} | ${concatAsReceiver(value)}`);
}

const absent: Items = { length: 2, 0: "a", 1: "b" };
show("no symbol", absent);
const present: Items = { length: 2, 0: "a", 1: "b", [Symbol.isConcatSpreadable]: true };
show("true in the literal", present);
show("no symbol, again", absent);
const presentFalse: Items = { length: 2, 0: "a", 1: "b", [Symbol.isConcatSpreadable]: false };
show("false in the literal", presentFalse);
const presentUndefined: Items = { length: 2, 0: "a", 1: "b", [Symbol.isConcatSpreadable]: undefined };
show("undefined in the literal", presentUndefined);

const stored: Items = { length: 2, 0: "a", 1: "b" };
show("before the store", stored);
stored[Symbol.isConcatSpreadable] = true;
show("after the store", stored);
stored[Symbol.isConcatSpreadable] = false;
show("after a store of false", stored);
stored[Symbol.isConcatSpreadable] = true;
delete stored[Symbol.isConcatSpreadable];
show("after the delete", stored);

const undeclared: Plain = { length: 2, 0: "a", 1: "b" };
show("before the undeclared store", undeclared);
(undeclared as any)[Symbol.isConcatSpreadable] = true;
show("after the undeclared store", undeclared);
show("another object of that type", { length: 2, 0: "c", 1: "d" } as Plain);

const defined: Plain = { length: 2, 0: "a", 1: "b" };
Object.defineProperty(defined, Symbol.isConcatSpreadable, { value: true });
show("defined, not enumerable", defined);
let getterCalls = 0;
const withGetter: Plain = { length: 2, 0: "a", 1: "b" };
Object.defineProperty(withGetter, Symbol.isConcatSpreadable, { get: () => (getterCalls++, true) });
show("defined as a getter", withGetter);
console.log("getter calls:", getterCalls);
const literalGetter = {
  length: 1,
  0: "g",
  get [Symbol.isConcatSpreadable](): boolean {
    getterCalls++;
    return true;
  },
};
show("getter in the literal", literalGetter);
console.log("getter calls:", getterCalls);

show("truthy value", { length: 1, 0: "t", [Symbol.isConcatSpreadable]: 1 });
show("falsy value", { length: 1, 0: "f", [Symbol.isConcatSpreadable]: "" });
show("no length", { 0: "n", [Symbol.isConcatSpreadable]: true });
show("holes", { length: 3, 1: "middle", [Symbol.isConcatSpreadable]: true });
show("frozen", Object.freeze({ length: 1, 0: "z", [Symbol.isConcatSpreadable]: true }));
show("copied by spread", { ...present });
show("copied by Object.assign", Object.assign({}, present));
show("inherits from a spreadable object", Object.create(present));

class Fields {
  length = 2;
  0 = "x";
  1 = "y";
  [Symbol.isConcatSpreadable] = true;
}
class WithoutSymbol {
  length = 2;
  0 = "x";
  1 = "y";
}
show("class field", new Fields());
show("class without the symbol", new WithoutSymbol());
const instance = new WithoutSymbol();
(instance as any)[Symbol.isConcatSpreadable] = true;
show("instance after an undeclared store", instance);
show("another instance", new WithoutSymbol());

const list = [1, 2];
show("array", list);
(list as any)[Symbol.isConcatSpreadable] = false;
show("array with an own false", list);
show("another array", [3, 4]);

function createItems(index: number): Items {
  const items: Items = { length: 2, 0: "i" + index, 1: "j" + index };
  if (index % 3 === 0) items[Symbol.isConcatSpreadable] = true;
  return items;
}
let total = 0;
for (let index = 0; index < 300; index++) total += ([] as unknown[]).concat(createItems(index), createItems(index + 1)).length;
console.log("300 pairs:", total);
console.log("several operands:", JSON.stringify(([] as unknown[]).concat(absent, present, [9], presentFalse, "s", stored, undeclared)));

export {};

// GENERATED: concatAsReceiver createItems WithoutSymbol get [Symbol.isConcatSpreadable]
// CHECK-LABEL: function {{*}}name="concatAsReceiver"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=ArrayPrototypeConcat
// CHECK-NEXT: v2 = PropGet v1 key="call"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(FunctionPrototypeCall) flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="tail"
// CHECK-NEXT: v5 = Call v3, v1, v0, v4 calleeKey="call" calleeName="Array.prototype.concat.call"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array site=[[w_2]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = PropGet v6 key="length"
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_3]]} illTypedCause=Assertion
// CHECK-NEXT: v9 = ToString v8
// CHECK-NEXT: v10 = String string=" "
// CHECK-NEXT: v11 = Builtin builtin=JSON
// CHECK-NEXT: v12 = PropGet v11 key="stringify"
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v14 = Call v13, v11, v6 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v16 = ToString v15
// CHECK-NEXT: v17 = Strcat v9, v10, v16
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="createItems"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_5]]}] results=[{type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = Convert v1 declared={type=number}
// CHECK-NEXT: v3 = String string="i"
// CHECK-NEXT: v4 = Add v3, v0
// CHECK-NEXT: v5 = NewObject -, v2 layout=[[L_6]] fields=[0]
// CHECK-NEXT: v6 = Integer
// CHECK-NEXT: ElemDefine v5, v6, v4
// CHECK-NEXT: v8 = String string="j"
// CHECK-NEXT: v9 = Add v8, v0
// CHECK-NEXT: v10 = Integer integer=1
// CHECK-NEXT: ElemDefine v5, v10, v9
// CHECK-NEXT: v12 = FinishObject v5
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[L_6]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v14 = Integer integer=3
// CHECK-NEXT: v15 = Mod v0, v14
// CHECK-NEXT: v16 = Integer
// CHECK-NEXT: v17 = StrictEq v15, v16
// CHECK-NEXT: Branch v17 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v18 = Boolean boolean=true
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|boolean site=[[w_9]]}
// CHECK-NEXT: PropSet v13, v19 key=@@isConcatSpreadable
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="WithoutSymbol"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_10]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_10]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_10]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_11]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=boolean site=[[w_12]]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="getterCalls"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_15]]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="getterCalls"
// CHECK-NEXT: PutModuleVariable v3 variable=[[g_14]]
// CHECK-NEXT: v7 = Boolean boolean=true
// CHECK-NEXT: v8 = Convert v7 declared={type=boolean site=[[w_12]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.isConcatSpreadable]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, IsNamedByComputedKey] thisType={type=anything} results=[{type=boolean site=[[w_16]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="getterCalls"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_15]]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="getterCalls"
// CHECK-NEXT: PutModuleVariable v3 variable=[[g_14]]
// CHECK-NEXT: v7 = Boolean boolean=true
// CHECK-NEXT: v8 = Convert v7 declared={type=boolean site=[[w_16]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
