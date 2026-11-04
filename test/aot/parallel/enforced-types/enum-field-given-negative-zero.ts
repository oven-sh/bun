// TypeScript lets every number into a type that lists members of a numeric enum. The slot is held to int32, and -0 is no int32: kept as the integer 0 it would answer `Object.is(flags, -0)` and `1 / flags` wrongly.
// Under: --aot-testing=CheckProofsAtRunTime: the type that a slot is held to
enum Flags { None = 0, Union = 1, Object = 2, Any = 4 }
class Type {
  flags: Flags;
  constructor(flags: Flags) {
    this.flags = flags;
  }
}
function show(type: Type): string {
  return (type.flags & Flags.Object) + " " + (type.flags | Flags.Any) + " " + (type.flags + 1) + " " + Object.is(type.flags, -0) + " " + 1 / type.flags;
}
function give(type: Type, flags: number) {
  type.flags = flags;
}
const given: number = JSON.parse("-0");
const straight = new Type(Flags.Union);
console.log("before", show(straight));
give(straight, given);
console.log("behind", show(straight));
give(straight, Flags.None);
console.log("honest again", show(straight));
console.log("made with it", show(new Type(given)));
for (let turn = 0; turn < 3; turn++) {
  const type = new Type(turn);
  const before = show(type);
  if (turn === 1) give(type, given);
  console.log(turn, before, "|", show(type));
}
