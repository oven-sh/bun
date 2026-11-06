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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}] results=[{type=undefined|null|[[L_1]] site=[[w_3]]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_1]] site=[[w_3]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="asyncArrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync, IsChecked] thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="async arrow"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string|object site=[[w_6]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="generator"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, IsChecked] thisType={type=anything} results=[{type=undefined|null|Generator<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = String string="generator"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = Yield v4
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Switch v7 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
