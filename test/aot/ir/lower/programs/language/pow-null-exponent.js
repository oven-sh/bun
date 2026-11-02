// RUN: lower
// OPTIONS: builtin-modules

// `10 ** null` is 1: null is 0 as a number, also where the compiler knows the exponent to be null and has code of its own for the bases 2 and 10.
const unknown = x => x;
const shown = (label, ...values) => console.log(label, ...values.map(value => `${typeof value} ${Object.is(value, -0) ? "-0" : String(value)}`));
shown("written", 10 ** null, 2 ** null, 0 ** null, (-3) ** null, 1.5 ** null, NaN ** null, Infinity ** null);
shown("other exponents", 10 ** false, 10 ** true, 2 ** true, 10 ** 0, 10 ** -0, 10 ** "", 10 ** "0", 2 ** "3", 10 ** [], 10 ** undefined, 2 ** undefined, 2 ** {}, 10 ** "x");
const constant = null;
shown("a constant", 10 ** constant, 2 ** constant);
let variable = null;
shown("a variable", 10 ** variable, 2 ** variable, unknown(10) ** variable, unknown(10) ** null, 10 ** unknown(null), 2 ** unknown(null));
function tenTo(x) { return 10 ** x; }
shown("a parameter that is always null", tenTo(null));
function twoTo(x) { return 2 ** x; }
shown("the same, of two", twoTo(null));
function tenToEither(x) { return 10 ** x; }
shown("a parameter that is null or a number", tenToEither(null), tenToEither(2), tenToEither(-1), tenToEither(0.5), tenToEither(400));
function twoToEither(x) { return 2 ** x; }
shown("the same, of two", twoToEither(null), twoToEither(10), twoToEither(-1), twoToEither(0.5), twoToEither(1024), twoToEither(-1075));
function tenToMissing(x) { return 10 ** x; }
shown("a parameter every caller leaves out", tenToMissing());
function power(base, x) { return base ** x; }
shown("both are parameters", power(10, null), power(2, null), power(null, null), power(null, 2));
function toNull(base) { return base ** null; }
shown("the base is a parameter", toNull(10), toNull(2.5), toNull("3"), toNull(null), toNull(undefined));
let assigned = 10;
assigned **= null;
shown("assigned", assigned);
let two = 2;
two **= null;
shown("assigned, of two", two);
shown("Math.pow", Math.pow(10, null), Math.pow(2, null), Math.pow(10, constant), Math.pow(unknown(10), null), Math.pow(10, undefined), Math.pow(2, true));
shown("null is the base", null ** 10, null ** null, null ** 0, false ** null, true ** null, "" ** null, "2" ** null, [] ** null, undefined ** null);
shown("used further", 10 ** null - 7, (10 ** null) | 0, [10 ** null][0], { n: 2 ** null }.n, `${10 ** null}`, Number.isNaN(10 ** null));

// GENERATED: tenTo toNull shown
// CHECK-LABEL: function {{*}}name="tenTo"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=10
// CHECK-NEXT: v2 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = Pow v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toNull"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = Null
// CHECK-NEXT: v3 = Pow v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="shown"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=Array flags=[IsFromCompiler]}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = NewArray v0 contents=anything
// CHECK-NEXT: v8 = PropGet v1 key="map"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v10 = NewClosure function=[[f_3]]
// CHECK-NEXT: v11 = Call v9, v1, v10 calleeKey="map" calleeName="values.map"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: AppendSpread v7, v12
// CHECK-NEXT: v14 = CallList v6, v4, v7 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v14
// CHECK-NEXT: }
