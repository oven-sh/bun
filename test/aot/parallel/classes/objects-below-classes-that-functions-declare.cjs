// A helper makes constructor functions below one that the program declares: the objects behind the first one have the layout of the one above.
// COUNTER: DynamicSubclassInstances >= 3
"use strict";
const R = globalThis[JSON.parse('"Reflect"')];
function Figure(kind, size) { this.kind = kind; this.size = size; this.inner = null; this.count = 0; }
Figure.prototype.area = function () { return this.size * this.size + (this.inner === null ? 0 : this.inner.area()); };
Figure.prototype.put = function (other) { this.inner = other; this.count++; return this; };
function below(parent, kind, members) {
  const made = function (size) { parent.call(this, kind, size); };
  made.prototype = Object.create(parent.prototype, { constructor: { value: made, writable: true, configurable: true } });
  for (const name of Object.keys(members)) made.prototype[name] = members[name];
  return made;
}
const Square = below(Figure, "square", {});
const Disc = below(Figure, "disc", { area() { return this.size * 3; } });
const Ring = below(Disc, "ring", { hole() { return this.size - 1; } });
const show = f => [f.kind, f.size, f.count, f.area(), Object.keys(f).join("/"), f.constructor === Object.getPrototypeOf(f).constructor, f instanceof Figure].join(" ");
// The first object of each comes before anything of the class above was made.
const firsts = [new Ring(4), new Disc(5), new Square(6)];
for (const f of firsts) console.log(show(f));
let sum = 0;
for (let i = 0; i < 400; i++) {
  const F = [Square, Disc, Ring][i % 3], f = new F(i % 7), g = new Figure("plain", i % 5);
  f.put(g); g.put(firsts[i % 3]);
  sum = (sum * 31 + f.area() + g.area() + f.count * 5 + (f.hole ? f.hole() : 0)) | 0;
}
console.log(sum, firsts.map(f => f.count).join());
// Chains without a constructor function that the program declares above them.
for (let i = 0; i < 6; i++) {
  const top = function (n) { this.n = n; }, low = below(top, "x", { twice() { return this.n * 2; } });
  const a = new low(i), b = new low(i + 1), c = new top(i + 2);
  console.log(i, a.n, b.n, c.n, typeof a.twice, typeof c.twice, a instanceof top, Object.keys(b).join());
}
// A prototype object changed behind the first objects, a constructor that gives back another object, one made by Reflect.construct.
Disc.prototype.area = function () { return -this.size; };
console.log(new Disc(3).area(), new Ring(3).area(), firsts[1].area());
const Odd = below(Figure, "odd", {}), given = new Figure("given", 9);
const Gives = function (size) { Figure.call(this, "gives", size); return size > 2 ? given : undefined; };
Gives.prototype = Odd.prototype;
console.log(show(new Gives(1)), "|", new Gives(3) === given);
const other = R.construct(Square, [8], Ring); console.log(other.kind, other.hole(), other instanceof Disc, Object.getPrototypeOf(other) === Ring.prototype);
for (let i = 0; i < 40; i++) { const F = below(Figure, "k" + i % 4, i % 2 ? { area() { return 1; } } : {}); sum = (sum * 7 + new F(i).area() + new F(i + 1).area() + new F(2).size) | 0; }
console.log(sum);
