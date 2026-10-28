// A property of an object above takes or refuses the stores under its own name, and has nothing to say about any other name. So an accessor that is defined on a prototype object, as
// compilers write one for older engines, and a prototype object that is frozen leave the other fields of the instances what they were: there from the start, read by one load.
// IR+ GetSlot v\d+ key="width"
// IR+ GetSlot v\d+ key="second"
// IR- (GetSlotOrUndefined|IsSlotFilled|PropGet) .*key="(width|height|first|second)"
function Box(width, height) {
  this.width = width;
  this.height = height;
}
Object.defineProperty(Box.prototype, "area", {
  get: function () {
    return this.width * this.height;
  },
  enumerable: false,
  configurable: true,
});
function areaOf(box) {
  return box.width * box.height;
}

class Pair {
  constructor(first, second) {
    this.first = first;
    this.second = second;
  }
  describe() {
    return this.first + " and " + this.second;
  }
}
Object.freeze(Pair.prototype);
function sumOf(pair) {
  return pair.first + pair.second;
}

// Under the name itself the store is taken or refused, and the field is not there.
function Taken(kept, area) {
  this.kept = kept;
  this.area = area;
}
const taken = [];
Object.defineProperty(Taken.prototype, "area", {
  set: function (value) {
    taken.push(value);
  },
  configurable: true,
});
class Refused {
  constructor(kept, describe) {
    this.kept = kept;
    this.describe = describe;
  }
  describe() {
    return "a method";
  }
}
Object.freeze(Refused.prototype);
function Limited(kept, limit) {
  this.kept = kept;
  this.limit = limit;
}
Object.defineProperty(Limited.prototype, "limit", { value: 9, writable: false });
function show(make) {
  try {
    const made = make();
    return [made.kept, made.area, typeof made.describe, made.limit, Object.keys(made).join()].join(" ");
  } catch (error) {
    return error.constructor.name;
  }
}

const boxes = [];
const pairs = [];
for (let i = 0; i < 50; i++) {
  boxes.push(new Box(i, 2));
  pairs.push(new Pair(i, 1));
}
let area = 0;
let sum = 0;
for (const box of boxes) area += areaOf(box) + box.area;
for (const pair of pairs) sum += sumOf(pair);
console.log(area, sum, new Pair(1, 2).describe(), Object.keys(new Box(1, 2)).join(), Object.keys(new Pair(1, 2)).join());
console.log(show(() => new Taken(1, 2)), taken.join());
console.log(show(() => new Refused(1, 2)));
console.log(show(() => new Limited(1, 2)));
