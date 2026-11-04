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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number}, {type=number}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: number, v1: number):
// CHECK-NEXT: v2 = Less v0, v1
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: v4 = LogicalNot v3
// CHECK-NEXT: v5 = ToBoolean v4
// CHECK-NEXT: v6 = LogicalNot v5
// CHECK-NEXT: v7 = Convert v6 declared={type=boolean}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ofNegation"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=boolean}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: v1 = ToBoolean v0
// CHECK-NEXT: v2 = LogicalNot v1
// CHECK-NEXT: v3 = Builtin builtin=Boolean
// CHECK-NEXT: v4 = Call v3, -, v2 calleeName="Boolean"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=boolean}}, {declared={type=boolean}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="count"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=boolean}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: v1 = ToBoolean v0
// CHECK-NEXT: v2 = LogicalNot v1
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: v4 = LogicalNot v3
// CHECK-NEXT: v5 = Boolean
// CHECK-NEXT: v6 = StrictEq v4, v5
// CHECK-NEXT: Branch v6 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: Jump -> next b3(v7)
// CHECK-NEXT: b2():
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: Jump -> next b3(v8)
// CHECK-NEXT: b3(v9):
// CHECK-NEXT: v10 = Convert v9 declared={type=number}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="readLate"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=boolean}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="late"
// CHECK-NEXT: v2 = ToBoolean v1
// CHECK-NEXT: v3 = LogicalNot v2
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: v5 = LogicalNot v4
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
