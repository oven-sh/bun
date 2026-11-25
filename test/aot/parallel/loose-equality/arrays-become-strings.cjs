// An array becomes a string by the conversions of its elements: what they do is seen.
const log = console.log.bind(console);
const kept = [];
let calls = 0;
function Vector(x, y) {
  this.x = x;
  this.y = y;
}
Vector.prototype.toString = function () {
  calls++;
  if (this.x === 3) kept.push(this);
  return "(" + this.x + " " + this.y + ")";
};
function Collision(aircraft, position) {
  this.aircraft = aircraft;
  this.position = position;
}
Collision.prototype.toString = function () {
  calls += 100;
  return "Collision(" + this.aircraft + " at " + this.position + ")";
};
class Amount {
  constructor(cents) {
    this.cents = cents;
  }
  valueOf() {
    return this.cents;
  }
  toString() {
    this.cents += 1;
    return "$" + this.cents;
  }
}
class Never {
  toString() {
    throw new RangeError("never");
  }
}
class Hinted {
  constructor(n) {
    this.n = n;
  }
  [Symbol.toPrimitive](hint) {
    kept.push(hint);
    return hint + this.n;
  }
}
const results = [];
for (let i = 0; i < 4; i++) {
  const collisions = [];
  for (let j = 0; j < i; j++) collisions.push(new Collision([new Vector(j, i), new Vector(i, j)], new Vector(i * j, 1)));
  results.push({ collisions, amounts: [new Amount(i), [new Amount(i + 10)]] });
}
for (const result of results) {
  log("Collisions: " + result.collisions);
  log(`${result.amounts}` + result.amounts, result.amounts[0].cents, result.amounts[1][0].cents);
}
log(calls, kept.length, kept.map(v => v.x).join());
try {
  log("a" + [1, new Never()]);
} catch (e) {
  log(e.name);
}
log("h" + [new Hinted(1), [new Hinted(2)]], [new Hinted(3)] == "string3", +[new Amount(6)], [[new Vector(1, 2)]] + "");
kept.length = 0;
const first = new Vector(3, 4);
const text = "" + [first, null, undefined, [first]];
kept[0].y = 9;
log(text, kept.length, kept[0] === first, first.y, "" + [first]);
