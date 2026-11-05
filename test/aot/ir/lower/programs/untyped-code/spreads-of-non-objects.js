// RUN: lower
// OPTIONS: builtin-modules

// Spreads of values that are no objects, written so that the compiler sees the constant: `...(c ? x : undefined)`, `...(c && x)`, `...null`, numbers, booleans, bigints, symbols; strings do have properties.
const show = value => JSON.stringify(value);
const r = { p: 1, q: 2 };
function orUndefined(c, i) { return { ...(c ? r : undefined), g: i }; }
function orNull(c, i) { return { g: i, ...(c ? r : null) }; }
function andObject(c, i) { return { g: i, ...(c && r), h: i }; }
function orFalse(c, i) { return { ...(c ? r : false), ...(c ? false : r), g: i }; }
function orNumber(c, i) { return { ...(c ? r : 0), g: i, ...(c ? r : 5.5), ...(c ? r : NaN) }; }
function orString(c, i) { return { ...(c ? r : "ab"), g: i, ...(c ? r : "") }; }
function orBigInt(c, i) { return { ...(c ? r : 10n), g: i }; }
function orSymbol(c, i) { return { ...(c ? r : Symbol.iterator), g: i }; }
function constants(i) { return { ...undefined, ...null, ...true, ...false, ...1, ...1.5, ..."xy", ...2n, g: i }; }
function onlyNothing() { return { ...undefined }; }
function inTry(c, i) { try { return { g: i, ...(c ? r : undefined), h: i }; } catch (e) { return e.name; } }
function nested(c, i) { return { a: { ...(c ? r : undefined) }, b: [{ ...(c && r), i }] }; }
function assign(c, i) { return Object.assign({ g: i }, c ? r : undefined, c ? null : r, 5, true); }
function restOf(c) { const { p, ...others } = c ? r : {}; return { ...others, ...(c ? undefined : others), p }; }
for (const c of [true, false, 0, 1, "", "s", null, undefined]) {
  for (const [name, f] of Object.entries({ orUndefined, orNull, andObject, orFalse, orNumber, orString, orBigInt, orSymbol, inTry, nested, assign }))
    console.log(name, show(c), show(f(c, 7)), Object.keys(f(c, 7)).join());
  console.log("restOf", show(c), show(restOf(c)));
}
console.log(show(constants(1)), show(onlyNothing()), Object.getPrototypeOf(onlyNothing()) === Object.prototype, onlyNothing() !== onlyNothing());
let sum = 0; for (let i = 0; i < 100000; i++) sum += orUndefined(i & 1, i).g + Object.keys(andObject(i & 2, i)).length + Object.keys(orFalse(i & 4, i)).length; console.log(sum);

// GENERATED: constants restOf show
// CHECK-LABEL: function {{*}}name="constants"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = CopyObject v1
// CHECK-NEXT: v3 = Null
// CHECK-NEXT: CopyDataProperties v2, v3
// CHECK-NEXT: v5 = Boolean boolean=true
// CHECK-NEXT: CopyDataProperties v2, v5
// CHECK-NEXT: v7 = Boolean
// CHECK-NEXT: CopyDataProperties v2, v7
// CHECK-NEXT: v9 = Integer integer=1
// CHECK-NEXT: CopyDataProperties v2, v9
// CHECK-NEXT: v11 = Double number=1.5
// CHECK-NEXT: CopyDataProperties v2, v11
// CHECK-NEXT: v13 = String string="xy"
// CHECK-NEXT: CopyDataProperties v2, v13
// CHECK-NEXT: v15 = BigInt digits="2"
// CHECK-NEXT: CopyDataProperties v2, v15
// CHECK-NEXT: v17 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropDefine v2, v17 key="g"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="restOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|boolean|number|string flags=[IsExpected]}] results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|boolean|number|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = ToBoolean v0
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="r"
// CHECK-NEXT: Jump -> next b6(v4, v2)
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v6 = Data data=[[d_3]]
// CHECK-NEXT: Jump -> next b6(v6, v5)
// CHECK-NEXT: b6(v7, v8):
// CHECK-NEXT: v9 = TypeTest v7 testedType=undefined|null
// CHECK-NEXT: Branch v9 -> taken b7(| 0), notTaken b9(| 0)
// CHECK-NEXT: b7(v10):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() frequency=Unlikely:
// CHECK-NEXT: v11 = NewRuntimeError runtimeError=NotDestructurable name="p"
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b9(v12):
// CHECK-NEXT: v13 = PropGet v12 key="p"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: v15 = NewObject layout=[[L_4]]
// CHECK-NEXT: CopyDataProperties v15, v12 excludedKeys=["p"]
// CHECK-NEXT: v17 = FinishObject v15
// CHECK-NEXT: v18 = NewObject layout=[[L_1]]
// CHECK-NEXT: CopyDataProperties v18, v17
// CHECK-NEXT: v20 = ToBoolean v8
// CHECK-NEXT: Branch v20 -> taken b10(| 0), notTaken b12(| 0)
// CHECK-NEXT: b10(v21):
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Jump -> next b14(v22)
// CHECK-NEXT: b12(v23):
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: Jump -> next b14(v17)
// CHECK-NEXT: b14(v24):
// CHECK-NEXT: CopyDataProperties v18, v24
// CHECK-NEXT: PropDefine v18, v14 key="p"
// CHECK-NEXT: v27 = FinishObject v18
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="stringify"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
