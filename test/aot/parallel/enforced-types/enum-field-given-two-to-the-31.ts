// TypeScript lets every number into a type that lists members of a numeric enum. The slot is held to int32: 2 ** 31, the first integer beyond it, and -(2 ** 31), the last within it, whose word a narrow slot keeps for a mark.
// Under: --aot-testing=CheckProofsAtRunTime: the type that a slot is held to
enum Flags { None = 0, Union = 1, Object = 2, Any = 4 }
class Type {
  flags: Flags;
  constructor(flags: Flags) {
    this.flags = flags;
  }
}
function show(type: Type): string {
  return (type.flags & Flags.Object) + " " + (type.flags | Flags.Any) + " " + (type.flags + 1) + " " + Object.is(type.flags, -0) + " " + String(type.flags);
}
function give(type: Type, flags: number) {
  type.flags = flags;
}
const given: number[] = JSON.parse("[2147483648, -2147483648, -2147483647, -2147483644, -2147483643, 2147483647, 4294967296]");
const straight = new Type(Flags.Union);
console.log("before", show(straight));
for (let i = 0; i < given.length; i++) {
  give(straight, given[i]);
  console.log("behind", show(straight), "|", show(new Type(given[i])));
  give(straight, Flags.Object);
  console.log("honest again", show(straight));
}
for (let turn = 0; turn < 3; turn++) {
  const type = new Type(turn);
  const before = show(type);
  if (turn === 1) give(type, given[0]);
  console.log(turn, before, "|", show(type));
}
