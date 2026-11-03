// RUN: lower
// CHECK-LABEL: function {{*}}name="anotherNumber"
// CHECK-NOT: TypeTest
// CHECK: = Call {{*}}calleeKey="isFinite"
// CHECK-LABEL: function {{*}}name="asValue"
// CHECK-NOT: TypeTest
// CHECK: = Builtin builtin=NumberIsFinite
// CHECK-LABEL: function {{*}}name="inCondition"
// CHECK: [[isNumber]] = TypeTest {{*}} testedType=number
// CHECK-NEXT: Branch [[isNumber]] -> taken [[numbers]](| 0), notTaken {{*}}
// CHECK: [[numbers]]([[number]]):
// CHECK: [[question]] = Builtin builtin=NumberIsFinite
// CHECK-NEXT: = Call [[question]], -, [[number]]
// CHECK-LABEL: function {{*}}name="twoOperands"
// CHECK-NOT: TypeTest
// CHECK: = Builtin builtin=NumberIsInteger
export function anotherNumber(value, Number) { return Number.isFinite(value) ? 1 : 0; }
export function asValue(value) { return Number.isFinite(value); }
export function inCondition(value) { return Number.isFinite(value) ? value + 1 : 0; }
export function twoOperands(value, other) { return Number.isInteger(value, other) ? 1 : 0; }
