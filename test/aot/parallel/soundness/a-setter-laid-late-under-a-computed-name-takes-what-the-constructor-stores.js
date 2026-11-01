// As its neighbor, but the accessor is laid on the prototype object in the middle of the run: the objects made before have the field, those made after do not.
var seen = [];
function Taken(a) {
  if (!(this instanceof Taken)) throw new TypeError("called without new");
  this.a = a;
  this.b = 2;
}
Taken.prototype[process.argv.length > 100 ? "a" : "other"] = 1;
var name = process.argv.length > 100 ? "b" : "a";
var own = 0;
var sum = 0;
for (var i = 0; i < 200; i++) {
  if (i === 100) Object.defineProperty(Taken.prototype, name, { get() { return -1; }, set(value) { seen.push(value); }, configurable: true });
  var made = new Taken(i);
  own += Object.hasOwn(made, "a") ? 1 : 0;
  sum += made.a + made.b;
}
console.log(sum, own, seen.length, seen[0], seen[99]);
