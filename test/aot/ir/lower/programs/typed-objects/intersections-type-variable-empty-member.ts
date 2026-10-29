// RUN: lower
// OPTIONS: builtin-modules

// Intersections type variable and empty member.
interface P0 { p0: number }
interface P1 { p1: number }
interface P2 { p2: number }
interface P3 { p3: number }
interface P4 { p4: number }
interface P5 { p5: number }
interface P6 { p6: number }
interface P7 { p7: number }
interface P8 { p8: number }
interface P9 { p9: number }
interface P10 { p10: number }
interface P11 { p11: number }
interface P12 { p12: number }
interface P13 { p13: number }
interface P14 { p14: number }
interface P15 { p15: number }
interface P16 { p16: number }
interface P17 { p17: number }
type Wide = P0 & P1 & P2 & P3 & P4 & P5 & P6 & P7 & P8 & P9 & P10 & P11 & P12 & P13 & P14 & P15 & P16 & P17;
type WideAndEmpty = Wide & {};
function sure<T>(value: T): T & {} { if (value === null || value === undefined) throw new Error("nothing"); return value; }
function field<T, K extends keyof T>(from: Partial<T>, key: K): Partial<T>[K] & {} { return sure(from[key]); }
function both<T extends Wide>(value: T & {}): T { return value; }
function widen(value: Wide): WideAndEmpty { return value; }
function narrow(value: WideAndEmpty): Wide { return value; }
const wide: Wide = { p0: 0, p1: 1, p2: 2, p3: 3, p4: 4, p5: 5, p6: 6, p7: 7, p8: 8, p9: 9, p10: 10, p11: 11, p12: 12, p13: 13, p14: 14, p15: 15, p16: 16, p17: 17 };
console.log(sure(3), sure("s"), field<Wide, "p5">({ p5: 5 }, "p5"), both(wide).p7, narrow(widen(wide)).p17);
try { sure(undefined); } catch (error) { console.log((error as Error).message); }

// GENERATED: sure field both widen
// CHECK-LABEL: function {{*}}name="sure"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b3(v3):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v4 = TypeTest v3 testedType=undefined
// CHECK-NEXT: Branch v4 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v5):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="Error" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v9 = String string="nothing"
// CHECK-NEXT: v10 = Construct v8, -, v9 calleeName="Error"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b7(v12):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="field"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|[[L_3]] site=[[w_4]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v3 = ElemGet v0, v1
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="sure"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="both"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[L_6]] site=[[w_7]]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_6]] site=[[w_7]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="widen"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_8]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_8]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_8]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
