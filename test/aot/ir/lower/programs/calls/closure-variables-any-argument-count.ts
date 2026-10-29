// RUN: lower
// OPTIONS: builtin-modules

// Closures with zero to six parameters, called through a variable with zero to six arguments.
type Callee = (a?: number, b?: number, c?: number, d?: number, e?: number, f?: number) => string;
const seed: number = 7;
function describe(values: Array<number | undefined>): string {
    return values.map(value => value === undefined ? "_" : String(value + seed)).join(",");
}
const callees: Callee[] = [
    () => "0:" + seed,
    a => "1:" + describe([a]),
    (a, b) => "2:" + describe([a, b]),
    (a, b, c) => "3:" + describe([a, b, c]),
    (a, b, c, d) => "4:" + describe([a, b, c, d]),
    (a, b, c, d, e) => "5:" + describe([a, b, c, d, e]),
    (a, b, c, d, e, f) => "6:" + describe([a, b, c, d, e, f]),
    (...rest) => "rest:" + describe(rest),
    (a = 40, b = a + 1) => "defaults:" + describe([a, b]),
    function (a, b) { return "arguments:" + arguments.length + ":" + describe([a, b]); },
];
function callWithEveryCount(callee: Callee): string {
    return [callee(), callee(1), callee(1, 2), callee(1, 2, 3), callee(1, 2, 3, 4), callee(1, 2, 3, 4, 5), callee(1, 2, 3, 4, 5, 6)].join(" ");
}
for (const callee of callees)
    console.log(callWithEveryCount(callee));

const holder: { run: Callee } = { run: callees[0] };
for (const callee of callees) {
    holder.run = callee;
    console.log(holder.run(), holder.run(1, 2, 3), holder.run(1, 2, 3, 4, 5, 6));
}

const tagged: Callee & { tag?: number } = (a, b) => "tagged:" + describe([a, b]);
console.log(callWithEveryCount(tagged));
tagged.tag = 1;
console.log(callWithEveryCount(tagged), tagged.tag);

class Point { constructor(public x = 1) {} }
const constructorAsCallee = Point as unknown as Callee;
try {
    console.log(constructorAsCallee(1));
} catch (error) {
    console.log("calling a class throws a TypeError:", error instanceof TypeError);
}

let depth = 0;
let descend: (n: number) => number = n => n;
descend = n => {
    depth = n;
    return descend(n + 1) + 1;
};
try {
    console.log(descend(0));
} catch (error) {
    console.log("endless recursion through a variable throws a RangeError:", error instanceof RangeError, depth > 1000);
}

// GENERATED: describe Point tagged descend
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|number> site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="map"
// CHECK-NEXT: v2 = NewClosure function=[[f_3]]
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeKey="map" calleeName="values.map"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = PropGet v4 key="join"
// CHECK-NEXT: v6 = String string=","
// CHECK-NEXT: v7 = Call v5, v4, v6 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v7 casts=[{declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Point"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=undefined|number site=[[w_5]]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_6]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_7]]
// CHECK-NEXT: v6 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_5]]}
// CHECK-NEXT: Jump -> next b5(v9)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: Jump -> next b5(v10)
// CHECK-NEXT: b5(v11):
// CHECK-NEXT: PropSet v4, v11 key="x"
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: v14 = TypeTest v13 testedType=object
// CHECK-NEXT: Branch v14 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v15):
// CHECK-NEXT: Jump -> next b8(v15)
// CHECK-NEXT: b7(v16):
// CHECK-NEXT: Jump -> next b8(v4)
// CHECK-NEXT: b8(v17):
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tagged"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|number site=[[w_8]]}, {type=undefined|number site=[[w_9]]}] results=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: undefined|number, v1: undefined|number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = String string="tagged:"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v4 = NewArray v0, v1 contents=undefined|number
// CHECK-NEXT: v5 = Call v3, -, v4 calleeName="describe"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = Add v2, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="descend"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=number site=[[w_14]]}] results=[{type=number site=[[w_15]]}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_15]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="descend"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=number site=[[w_17]]}] results=[{type=number site=[[w_18]]}] functionTypes={{*}}[[f_19]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_20]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="depth"
// CHECK-NEXT: v3 = Convert v0 declared={type=number site=[[w_21]]}
// CHECK-NEXT: PutModuleVariable v3 variable=[[g_20]]
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_22]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="descend"
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = Call v6, -, v8 calleeName="descend"
// CHECK-NEXT: v10 = Convert v9 declared={type=number site=[[w_23]]}
// CHECK-NEXT: v11 = Integer integer=1
// CHECK-NEXT: v12 = Add v10, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=number site=[[w_18]]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
