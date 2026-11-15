// A question about a number is a call of the built-in, in a condition as anywhere else. No test of the type stands in front of it,
// and the arm behind it reads the value as it came.

// RUN: lower
// CHECK-LABEL: function {{*}}name="anotherNumber"
// CHECK: = Call {{*}}calleeKey="isFinite"
// CHECK-LABEL: function {{*}}name="asValue"
// CHECK: [[asked]] = Builtin builtin=NumberIsFinite
// CHECK-NEXT: = Call [[asked]], {{*}}calleeName="Number.isFinite"
// CHECK-LABEL: function {{*}}name="inCondition"
// CHECK: b0([[value]]: anything):
// CHECK: [[question]] = Builtin builtin=NumberIsFinite
// CHECK-NEXT: [[answer]] = Call [[question]], {{*}}, [[value]] calleeName="Number.isFinite"
// CHECK-NEXT: [[test]] = ToBoolean [[answer]]
// CHECK-NEXT: Branch [[test]] -> taken
// CHECK: = Add [[value]],
// CHECK-LABEL: function {{*}}name="twoOperands"
// CHECK: = Builtin builtin=NumberIsInteger

// RUN(NOWHERE): lower
// NOWHERE-NOT: TypeTest

export function anotherNumber(value, Number) { return Number.isFinite(value) ? 1 : 0; }
export function asValue(value) { return Number.isFinite(value); }
export function inCondition(value) { return Number.isFinite(value) ? value + 1 : 0; }
export function twoOperands(value, other) { return Number.isInteger(value, other) ? 1 : 0; }
