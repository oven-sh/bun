// The constructor of a base class is entered for whatever new.target a caller hands over: the class itself, classes below it, classes that are evaluated again and again,
// functions and classes that are not below it. Each object has the prototype, the fields and the order of keys that the language gives it.
class Shape { sides = 0; area = 0.5; label; constructor(sides) { if (sides !== undefined) this.sides = sides; } describe() { return this.constructor.name + ":" + Object.keys(this).join() + ":" + this.sides + ":" + this.area; } }
class Square extends Shape { edge = 2; constructor(sides) { super(sides); this.area = this.edge * this.edge; } }
class Cube extends Square { depth = 1.25; }
class Renamed extends Shape { sides = "many"; area = null; }
class Empty extends Shape { }
class Other { other = 1; }
function Plain() { }
Plain.prototype.describe = function () { return "plain:" + Object.keys(this).join(); };
function make(table, which, argument) { const C = table[which]; return new C(argument); }
const table = [Shape, Square, Cube, Renamed, Empty];
const lines = [];
for (let round = 0; round < 3; round++) {
  for (let which = 0; which < table.length; which++) {
    const made = make(table, which, round ? round + which : undefined);
    lines.push(made.describe() + ":" + (Object.getPrototypeOf(made) === table[which].prototype) + ":" + (made instanceof Shape));
  }
  if (typeof Bun !== "undefined") Bun.gc(true);
}
console.log(lines.join("\n"));

function construct(base, target) { return Reflect.construct(base, [7], target); }
for (const target of [Shape, Cube, Other, Plain, Plain.bind(null), new Proxy(Square, {}), Array, class extends Empty { late = true; }]) {
  const made = construct(Shape, target);
  console.log(typeof target.prototype, Object.keys(made).join(), made.sides, Object.getPrototypeOf(made) === (target.prototype ?? Object.prototype), made instanceof Shape, Array.isArray(made));
}
Plain.prototype = null;
console.log(Object.getPrototypeOf(construct(Shape, Plain)) === Object.prototype, Object.getPrototypeOf(construct(Square, Plain)) === Object.prototype, Object.keys(construct(Cube, Plain)).join());

function below(base, tag) { return class extends base { tag = tag; }; }
let sum = 0;
const many = [];
for (let i = 0; i < 70; i++) many.push(below(i % 3 ? Square : Shape, i));
for (let turn = 0; turn < 2000; turn++) {
  const C = many[turn % many.length];
  const made = new C(turn & 3);
  if (Object.getPrototypeOf(made) !== C.prototype || made.tag !== turn % many.length) throw new Error("another class at " + turn);
  sum += made.sides + made.area + Object.keys(made).length;
}
console.log(sum);

Object.setPrototypeOf(Cube.prototype, Other.prototype);
Object.setPrototypeOf(Cube, Shape);
const moved = make(table, 2, 9);
console.log(Object.keys(moved).join(), moved instanceof Square, moved instanceof Cube, moved.sides, moved.depth, moved.edge);
let kept = [];
for (let i = 0; i < 30000; i++) { const made = make(table, 1 + (i & 1), i); if (!(i % 5000)) kept.push(made); }
console.log(kept.map(made => Object.keys(made).join() + made.sides).join(" "));
