// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: ConstantNotInt32 2
// DIAGNOSTIC: UnprovenInt32 13

// An enum or a union of literals is an `int32` by proof only if every member is one: not with a fraction, -0 or 2 ** 31 among the members, with members computed when the program runs, or for an enum that is only declared. Arithmetic on an enum value is held to the range of an int32, not to that of the members, because TypeScript lets any number into a numeric enum. structural-types/an-enum-that-holds-any-number-is-taken-for-an-int32 has the enums that are accepted, with other numbers in them.
import type { int32 } from "bun";

const given: number[] = JSON.parse("[1.5]");
function compute(): number { return given[0]; }
enum Color { Red, Green, Blue }
enum Odd { Half = 0.5, One = 1 }
enum Big { Huge = 2147483648, One = 1 }
enum Made { First = compute(), Second = "abc".length, Third = Color.Blue }
enum Minus { Zero = -0, One = 1 }
declare enum Ambient { A, B }
function withAFraction(value: Odd): int32 { return value; }
function withAHugeMember(value: Big): int32 { return value; }
function computed(value: Made): int32 { return value; }
function withNegativeZero(value: Minus): int32 { return value; }
function oneComputedMember(value: Made.First): int32 { return value; }
function theComputedMember(): int32 { return Made.First; }
function theLength(): int32 { return Made.Second; }
function theFraction(): int32 { return Odd.Half; }
function theNegativeZero(): int32 { return Minus.Zero; }
function onlyDeclared(value: Ambient): int32 { return value; }
function negated(color: Color): int32 { return -color; }
function doubled(color: Color): int32 { return color * 2; }
function next(color: Color): int32 { return color + 1; }
function distance(color: Color): int32 { return Math.abs(color); }
function fractionOrTwo(value: 1.5 | 2): int32 { return value; }

console.log(withAFraction(1), withAHugeMember(1), computed(given[0]), withNegativeZero(1), oneComputedMember(given[0]), theComputedMember(), theLength(), theFraction(), theNegativeZero(), onlyDeclared(given[0]), negated(1), doubled(1), next(1), distance(1), fractionOrTwo(2));

// GENERATED: compute withAHugeMember theComputedMember theFraction negated doubled next distance
// CHECK-LABEL: function {{*}}name="compute"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_1]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="given"
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = ElemGet v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_3]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="withAHugeMember"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=int[-2147483648, 2147483648] site=[[w_4]]}] results=[{type=i32 site=[[w_5]] flags=[IsInt32Promise]}] {
// CHECK-NEXT: b0(v0: int[-2147483648, 2147483648]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=i32 site=[[w_5]] flags=[IsInt32Promise]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="theComputedMember"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=i32 site=[[w_6]] flags=[IsInt32Promise]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v2 = PropGet v1 key="First"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: v4 = Convert v3 declared={type=i32 site=[[w_6]] flags=[IsInt32Promise]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="theFraction"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=i32 site=[[w_9]] flags=[IsInt32Promise]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Double number=0.5
// CHECK-NEXT: v1 = Convert v0 declared={type=i32 site=[[w_9]] flags=[IsInt32Promise]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="negated"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=i32 site=[[w_10]]}] results=[{type=i32 site=[[w_11]] flags=[IsInt32Promise]}] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Negate v0
// CHECK-NEXT: v2 = Convert v1 declared={type=i32 site=[[w_11]] flags=[IsInt32Promise]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="doubled"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=i32 site=[[w_12]]}] results=[{type=i32 site=[[w_13]] flags=[IsInt32Promise]}] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = Mul v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=i32 site=[[w_13]] flags=[IsInt32Promise]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="next"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=i32 site=[[w_14]]}] results=[{type=i32 site=[[w_15]] flags=[IsInt32Promise]}] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=i32 site=[[w_15]] flags=[IsInt32Promise]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="distance"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=i32 site=[[w_16]]}] results=[{type=i32 site=[[w_17]] flags=[IsInt32Promise]}] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Math
// CHECK-NEXT: v2 = Builtin builtin=MathAbs
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Math.abs"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=number site=[[w_18]]}}, {declared={type=i32 site=[[w_17]] flags=[IsInt32Promise]}}]
// CHECK-NEXT: }
