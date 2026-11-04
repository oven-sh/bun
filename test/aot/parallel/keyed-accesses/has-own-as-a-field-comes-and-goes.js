// The boxes have fields `size` and `depth` whose slots are empty, below a class that nobody knows at the build. Object.hasOwn() answers from the slot of the field where a read has filed "the slot, else what stands above".
// One box after the other gets a name for itself, each in another way, loses it again, and what stands above changes: an accessor, nothing, a plain value, a proxy.
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
console.log(countOwn(2000));

function ownNames(box) {
  return names.filter(name => Object.hasOwn(box, name)).join() + " | " + names.filter(name => Object.prototype.hasOwnProperty.call(box, name)).join() + " | " + box.size + " " + box.depth;
}
// One box after the other gets the name for itself, each in another way, and the others must go on saying no.
Object.defineProperty(boxes[1], "size", { value: 5, writable: true, enumerable: true, configurable: true });
Object.defineProperty(boxes[2], "size", { get() { return 9; }, configurable: true });
Object.defineProperty(boxes[3], "size", { value: undefined, writable: true, enumerable: true, configurable: true });
Object.defineProperty(boxes[4], "size", { value: 7 });
Object.defineProperty(boxes[5], "count", { value: 1, configurable: true });
Object.freeze(boxes[6]);
boxes[7].depth = undefined;
for (const box of boxes) console.log(ownNames(box));
console.log(countOwn(800));
delete boxes[1].size;
delete boxes[2].size;
delete boxes[3].size;
delete boxes[5].count;
delete boxes[7].depth;
for (const box of boxes) console.log(ownNames(box));
console.log(countOwn(800));
// The accessor above goes away: a store now lays the name on the box.
delete Parent.prototype.size;
boxes[0].size = 11;
boxes[7].size = undefined;
for (const box of boxes) console.log(ownNames(box));
console.log(countOwn(800));
// A plain value above, then a proxy, then nothing.
Parent.prototype.size = 4;
Parent.prototype.depth = 6;
for (const box of boxes) console.log(ownNames(box));
console.log(countOwn(800));
Object.setPrototypeOf(Box.prototype, new Proxy({}, { has() { return true; }, get() { return 13; }, getOwnPropertyDescriptor() { return undefined; } }));
for (const box of boxes) console.log(ownNames(box));
console.log(countOwn(800));
Object.setPrototypeOf(boxes[1], null);
console.log(names.filter(name => Object.hasOwn(boxes[1], name)).join());
