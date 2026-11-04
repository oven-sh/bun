// TypeScript lets every number into a type that lists members of a numeric enum. The slot is held to int32: NaN and the infinities take the field out of its slot in that object.
// Under: --aot-testing=CheckProofsAtRunTime: the type that a slot is held to
enum Flags { None = 0, Union = 1, Object = 2, Any = 4 }
class Type {
  flags: Flags;
  constructor(flags: Flags) {
    this.flags = flags;
  }
}
function show(type: Type): string {
  return (type.flags & Flags.Object) + " " + (type.flags | Flags.Any) + " " + (type.flags + 1) + " " + (type.flags === type.flags) + " " + String(type.flags);
}
function give(type: Type, flags: number) {
  type.flags = flags;
}
const given: number[] = [Number(JSON.parse('"no number"')), 1 / Number(JSON.parse('"0"')), -1 / Number(JSON.parse('"0"'))];
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
