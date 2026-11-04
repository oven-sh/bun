// RUN: lower
// OPTIONS: builtin-modules

// The initializer of each constant is a function wrapped in syntax that leaves no trace at run time, and each reference is wrapped too.
type Fn = () => string;
const viaAs = function () { return "as"; } as Fn;
const viaSatisfies = (() => "satisfies") satisfies Fn;
const viaAngle = <Fn>function () { return "angle"; };
const viaNonNull = (() => "non-null")!;
const viaParentheses = ((() => "parentheses"));
const viaAnnotation: Fn = () => "annotation";
const viaAsConst = (() => "as const") as Fn as unknown as Fn;
const generic = <T,>(value: T): T => value;
const asyncArrow = async () => "async arrow";
const generator = function* () { yield "generator"; };

console.log((viaAs as Fn)(), viaSatisfies!(), (<Fn>viaAngle)(), (viaNonNull satisfies Fn)(), ((viaParentheses))());
console.log(viaAnnotation(), viaAsConst(), generic<string>("generic"), await asyncArrow(), [...generator()][0]);

// GENERATED: generic asyncArrow generator
// CHECK-LABEL: function {{*}}name="generic"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="asyncArrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="async arrow"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="generator"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = String string="generator"
// CHECK-NEXT: v4 = Yield v3
// CHECK-NEXT: v5 = ResultAt v4
// CHECK-NEXT: v6 = ResultAt v4 index=1
// CHECK-NEXT: Switch v6 cases=[1, 2] -> case b1(), case b2(), otherwise b3()
// CHECK-NEXT: b1():
// CHECK-NEXT: Throw v5
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v5
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
