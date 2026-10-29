// RUN: lower
// OPTIONS: builtin-modules

// A namespace and an enum of one name are one object, whichever comes first. Where the namespace comes first it is its block that makes the object.
namespace First { export class Point { constructor(public x: number) {} } export const two = 2; }
enum First { Red, Blue }
console.log(First.Red, First.Blue, new First.Point(1).x, First.two, First[0], Object.keys(First).join());

namespace WithAVariable { export var y = 2; }
enum WithAVariable { One }
console.log(WithAVariable.y, WithAVariable.One, Object.keys(WithAVariable).join());

namespace WithAFunction { export function red() { return WithAFunction.Red; } }
enum WithAFunction { Red = 5 }
console.log(WithAFunction.red(), WithAFunction.Red);

function computed(): number { return 7; }
namespace WithAComputedMember { export const before = 1; }
enum WithAComputedMember { Seven = computed() }
console.log(WithAComputedMember.before, WithAComputedMember.Seven, WithAComputedMember[7], Object.keys(WithAComputedMember).join());

namespace BetweenTwo { export const first = 1; }
enum BetweenTwo { A }
namespace BetweenTwo { export const second = 2; }
enum BetweenTwo { B = 1 }
console.log(BetweenTwo.first, BetweenTwo.second, BetweenTwo.A, BetweenTwo.B, Object.keys(BetweenTwo).join());

enum Behind { Red, Blue }
namespace Behind { export const two = 2; }
console.log(Behind.Red, Behind.two, Object.keys(Behind).join());

const held: object = First;
console.log(held === First, (held as Record<string, unknown>).two);

// GENERATED: computed Point
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_1]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=7
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_1]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Point"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_2]]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_4]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_5]]
// CHECK-NEXT: PropSet v4, v1 key="x"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
