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
