// A class below writes a field of the class above anew, narrower: `kind: Kind.Leaf` over `kind: Kind`, `value: number` over `value: number | string`, `x = 1` with no type at all. The two lie in one slot.
// A store through the class above brings what the class below rules out, into an object of the class below. What lies at one slot is held to one type, or to none.
// Under: --aot-testing=CheckProofsAtRunTime: the type that a slot is held to
enum Kind { Branch, Leaf, Root }
class Above {
  kind: Kind;
  value: number | string;
  x: number;
  constructor(kind: Kind, value: number | string) {
    this.kind = kind;
    this.value = value;
    this.x = 5;
  }
}
class Below extends Above {
  kind: Kind.Leaf = Kind.Leaf;
  value: number = 7;
  x = 1;
}
function show(above: Above): string {
  return above.kind + " " + above.value + " " + typeof above.value + " " + (above.x + 1) + " " + Object.keys(above).join();
}
function showBelow(below: Below): string {
  return (below.kind === Kind.Leaf) + " " + (below.value + 1) + " " + (below.x + 1);
}
function change(above: Above, kind: Kind, value: number | string, x: number) {
  above.kind = kind;
  above.value = value;
  above.x = x;
}
const straight = new Below(Kind.Root, "ignored");
console.log("before", show(straight), "|", showBelow(straight));
change(straight, Kind.Root, "text", 2.5);
console.log("behind", show(straight), "|", showBelow(straight));
change(straight, Kind.Leaf, 8, 3);
console.log("honest again", show(straight), "|", showBelow(straight));
for (let turn = 0; turn < 3; turn++) {
  const above: Above = turn === 1 ? new Below(Kind.Branch, turn) : new Above(Kind.Branch, "above" + turn);
  const before = show(above);
  change(above, Kind.Root, turn === 2 ? turn : "turn" + turn, turn + 0.5);
  console.log(turn, before, "|", show(above));
}
