// A loose equality converts an object beside a primitive that is neither undefined nor null. What the conversion does is seen: it keeps the object, changes another, throws.
const kept = [];
let calls = 0;

function Seat(row, place) {
  this.place = place;
  this.row = row;
}
Seat.prototype.toString = function () {
  kept.push(this);
  calls++;
  return this.row + ":" + this.place;
};

class Amount {
  constructor(cents) {
    this.cents = cents;
    this.asked = 0;
  }
  valueOf() {
    this.asked++;
    return this.cents;
  }
}

class Guarded {
  constructor(secret) {
    this.secret = secret;
  }
  [Symbol.toPrimitive](hint) {
    if (this.secret === 3) throw new Error("no " + hint);
    return this.secret;
  }
}

function Bead(color, before) {
  this.before = before;
  this.color = color;
  this.behind = null;
}
Bead.prototype.toString = function () {
  calls += 1000;
  return "a bead of " + this.color;
};

const cord = { first: null, last: null };
function thread(color) {
  const bead = new Bead(color, cord.last);
  if (cord.first == null) cord.first = bead;
  else cord.last.behind = bead;
  cord.last = bead;
}
function marks(bead) {
  let sum = 0;
  if (bead == cord.first) sum++;
  if (cord.last == bead) sum += 10;
  if (bead.before != null && bead.before.behind != bead) sum += 100;
  return sum;
}

function same(a, b) {
  return a == b;
}

for (const color of [5, 2, 8, 1, 9, 3, 7]) thread(color);
let ends = 0;
for (let bead = cord.first; bead != null; bead = bead.behind) ends = ends * 3 + marks(bead);
cord.first.behind = cord.last;
for (let bead = cord.last; bead != undefined; bead = bead.before) ends += marks(bead);
console.log(ends, calls);

const values = [0, 1, -0, NaN, 3n, "", "1:2", "3", true, false, null, undefined, Symbol.iterator, "x"];
let yes = 0;
for (let i = 0; i < values.length * 3; i++) {
  const value = values[i % values.length];
  const objects = [new Seat(1, 2), new Amount(i % 5), new Guarded(i % 4)];
  for (const object of objects) {
    try {
      if (same(object, value)) yes++;
      if (same(value, object)) yes += 100;
      if (object != object) yes += 10000;
      if (same(object, objects[0])) yes += 100000;
    } catch (e) {
      yes += 1000000;
    }
  }
  if (objects[1].asked > 2) yes += 1e9;
}
console.log(yes, calls, kept.length, kept[0] === kept[1], kept.every(v => v.row === 1));
const first = new Seat(7, 8);
let mixed = first;
for (let i = 0; i < 6; i++) {
  if (mixed == (i & 1 ? "7:8" : first)) calls += 10000;
  mixed = i === 3 ? "7:8" : first;
}
kept[kept.length - 1].row = 70;
console.log(calls, first.row, String(first));
