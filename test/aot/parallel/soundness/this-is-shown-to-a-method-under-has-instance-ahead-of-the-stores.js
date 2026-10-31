// `this instanceof F` ahead of the stores, where F has a method of its own under Symbol.hasInstance: the method sees the object without its fields.
var seen = [];
function Shown(a) {
  if (!(this instanceof Shown)) throw new TypeError("called without new");
  this.a = a;
  this.b = 2;
}
Object.defineProperty(Shown, Symbol.hasInstance, {
  value: function (object) {
    seen.push(Object.keys(object).join() + "|" + object.a + "|" + object.b);
    kept = object;
    return true;
  },
});
var kept;
function read(object) {
  return object.a + object.b;
}
var sum = 0;
for (var i = 0; i < 200; i++) sum += read(new Shown(i));
console.log(sum, seen.length, seen[0], seen[199], read(kept));
