// The prototype object gets an accessor under a name that only the run knows, so the class cannot list its names. The constructor's store under that name runs the setter and makes no field; the other field is made.
var seen = [];
function Taken(a) {
  if (!(this instanceof Taken)) throw new TypeError("called without new");
  this.a = a;
  this.b = 2;
}
var name = process.argv.length > 100 ? "b" : "a";
Object.defineProperty(Taken.prototype, name, {
  get() { return -1; },
  set(value) { seen.push(value); },
  configurable: true,
});
var sum = 0;
var last;
for (var i = 0; i < 200; i++) {
  last = new Taken(i);
  sum += last.a + last.b;
}
console.log(sum, seen.length, seen[199], Object.keys(last).join());
