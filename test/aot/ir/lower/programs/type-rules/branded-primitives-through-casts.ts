// RUN: lower
// OPTIONS: builtin-modules

// A brand is a phantom: no value has it when the program runs. A branded string, and the `void & { brand }` beside it, is a string or `undefined`, so a cast from it to `string` is no cast of an object, and `.slice` on the result is the string's. A real object cast to `string` is still let through, and the place that receives it takes it. Every line prints what plain Bun prints.
type Escaped = (string & { __escaped: void }) | (void & { __escaped: void }) | "known";
type Id = number & { __tag: "id" };
const hide = (value: unknown): unknown => value;

function escape(text: string): Escaped { return (text.startsWith("__") ? "_" + text : text) as Escaped; }
function unescape(name: Escaped): string { const text = name as string; return text.length >= 3 && text.startsWith("___") ? text.slice(1) : text; }
function firstOf(text: string): string { return text.slice(0, 1); }
function next(id: Id): number { return (id as number) + 1; }
function describe(text: string): string { return typeof text + " " + String(text === undefined ? "nothing" : text.slice(0, 2)); }

console.log(unescape(escape("__proto__")), unescape(escape("plain")), unescape("known"));
console.log(firstOf(unescape(escape("abc"))), firstOf(escape("xyz") as string));
console.log(next(41 as Id), next(hide(1) as Id));
console.log(describe(hide(undefined) as Escaped as string));
const names: Escaped[] = [escape("a"), escape("__b"), "known"];
console.log(names.map(name => unescape(name)).join(","));

const sliceable = { slice: (from: number, to: number) => "object " + from + to };
console.log(firstOf(sliceable as unknown as string), describe(sliceable as unknown as string));

// GENERATED: unescape firstOf describe slice
// CHECK-LABEL: function {{*}}name="unescape"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = PropGet v1 key="length"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_4]]} illTypedCause=Assertion
// CHECK-NEXT: v4 = Integer integer=3
// CHECK-NEXT: v5 = GreaterEq v3, v4
// CHECK-NEXT: Branch v5 -> taken b2(), notTaken b6()
// CHECK-NEXT: b2():
// CHECK-NEXT: v6 = PropGet v1 key="startsWith"
// CHECK-NEXT: v7 = String string="___"
// CHECK-NEXT: v8 = Call v6, v1, v7 calleeKey="startsWith" calleeName="text.startsWith"
// CHECK-NEXT: v9 = Convert v8 declared={type=boolean site=[[w_5]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v10 = ToBoolean v9
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b5(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = PropGet v1 key="slice"
// CHECK-NEXT: v13 = Integer integer=1
// CHECK-NEXT: v14 = Call v12, v1, v13 calleeKey="slice" calleeName="text.slice"
// CHECK-NEXT: ReturnCall v14 casts=[{declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b5(v15):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="firstOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="slice"
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Call v1, v0, v2, v3 calleeKey="slice" calleeName="text.slice"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeOf v0
// CHECK-NEXT: v2 = String string=" "
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Builtin builtin=String
// CHECK-NEXT: v5 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = String string="nothing"
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v9 = PropGet v8 key="slice"
// CHECK-NEXT: v10 = Integer
// CHECK-NEXT: v11 = Integer integer=2
// CHECK-NEXT: v12 = Call v9, v8, v10, v11 calleeKey="slice" calleeName="text.slice"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b6(v13)
// CHECK-NEXT: b6(v14):
// CHECK-NEXT: v15 = Call v4, -, v14 calleeName="String"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v17 = Add v3, v16
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="slice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=number site=[[w_14]]}, {type=number site=[[w_15]]}] results=[{type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0(v0: number, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = String string="object "
// CHECK-NEXT: v3 = Add v2, v0
// CHECK-NEXT: v4 = Add v3, v1
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
