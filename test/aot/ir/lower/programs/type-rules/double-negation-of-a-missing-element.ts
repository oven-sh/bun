// RUN: lower
// OPTIONS: builtin-modules

// An element read out of range has the type boolean and is undefined. `!!x` and `Boolean(x)` make a boolean of whatever x is.
// Where the operand is made by an operation that always gives a boolean, nothing is converted.
const flags: boolean[] = [true, false];
const missing = flags[7];
console.log(!!missing, Boolean(missing), !(!missing), !!flags[7]);
console.log(!!missing === false, typeof !!missing, JSON.stringify({ on: !!missing }));
const count = (on: boolean): number => (!!on === false ? 0 : 1);
console.log(count(missing), count(flags[0]), count(flags[1]));
const held: { on: boolean } = JSON.parse("{}");
const later = held.on;
console.log(!!later, Boolean(later), !!held.on);
let late: boolean;
const readLate = (): boolean => !!late;
console.log(readLate());
late = true;
console.log(readLate());
function ofComparison(a: number, b: number): boolean { const less = a < b; return !!less; }
function ofNegation(on: boolean): boolean { const off = !on; return Boolean(off); }
console.log(ofComparison(1, 2), ofComparison(2, 1), ofNegation(true), ofNegation(false));

// GENERATED: ofComparison ofNegation count readLate
// CHECK-LABEL: function {{*}}name="ofComparison"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number site=[[w_1]]}, {type=number site=[[w_2]]}] results=[{type=boolean site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: number, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Less v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean site=[[w_4]]}
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: v5 = LogicalNot v4
// CHECK-NEXT: v6 = ToBoolean v5
// CHECK-NEXT: v7 = LogicalNot v6
// CHECK-NEXT: v8 = Convert v7 declared={type=boolean site=[[w_3]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ofNegation"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=boolean site=[[w_5]]}] results=[{type=boolean site=[[w_6]]}] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = ToBoolean v0
// CHECK-NEXT: v2 = LogicalNot v1
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean site=[[w_7]]}
// CHECK-NEXT: v4 = Builtin builtin=Boolean
// CHECK-NEXT: v5 = Call v4, -, v3 calleeName="Boolean"
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=boolean site=[[w_8]]}}, {declared={type=boolean site=[[w_6]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="count"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=boolean site=[[w_9]]}] results=[{type=number site=[[w_10]]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = ToBoolean v0
// CHECK-NEXT: v2 = LogicalNot v1
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: v4 = LogicalNot v3
// CHECK-NEXT: v5 = Boolean
// CHECK-NEXT: v6 = StrictEq v4, v5
// CHECK-NEXT: Branch v6 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: Jump -> next b4(v7)
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: Jump -> next b4(v8)
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = Convert v9 declared={type=number site=[[w_10]]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="readLate"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=boolean site=[[w_12]]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="late"
// CHECK-NEXT: v2 = Convert v1 declared={type=boolean} illTypedCause=Assertion
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: v4 = LogicalNot v3
// CHECK-NEXT: v5 = ToBoolean v4
// CHECK-NEXT: v6 = LogicalNot v5
// CHECK-NEXT: v7 = Convert v6 declared={type=boolean site=[[w_12]]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
