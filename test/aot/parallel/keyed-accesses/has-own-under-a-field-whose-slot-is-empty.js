// COUNT: operation:operationAOTInByValGeneric <= 200
// COUNT: operation:operationAOTHasOwnByValAndCache <= 200
// The boxes have a field `size` whose slot is empty, and the class above them, which nobody knows at the build, has an accessor under the name.
// A read under the name is filed as "the slot, else the getter above". Object.hasOwn(box, name) found that, could not tell from it, and came to the run time at every question:
// five times a request in node:http, 900 instructions each. Where no read had filed it, every eighth question came there, and filed nothing. An empty slot says that the object has no such property.
const parents = [
  class {
    get size() { return this.held; }
    set size(value) { this.held = value; }
    get count() { return 2; }
  },
  class {},
];
const Parent = parents[process.argv.length > 99 ? 1 : 0];
class Box extends Parent {
  size = 1;
  depth = 1;
  constructor(held) {
    super();
    this.held = held;
  }
}
const boxes = [];
for (let index = 0; index < 8; index++) boxes.push(new Box(index));
for (const box of boxes) {
  delete box.size;
  delete box.depth;
}

const names = ["size", "count", "held", "none", "depth"];
const others = [{ size: 1 }, { size: 2, more: 1 }, [1], new Map([[1, 1]])];
function sizeOf(sized) {
  return sized.size;
}
function countOwn(rounds) {
  let own = 0;
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    const box = boxes[round & 7];
    sum += sizeOf(box) + (sizeOf(others[round & 3]) ?? 0);
    for (const name of names) if (Object.hasOwn(box, name)) own++;
  }
  return own + " " + sum;
}
console.log(countOwn(20000));
