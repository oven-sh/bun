// The heir lays a member of its own and then copies the members of the base, name by name, in a for-in loop. The base returns `this`, so the two share their calls.
// The base loses the method before its first object is made, and the compiler need not make that object at all.
function Base(x) {
  this.x = x;
  return this;
}
Base.prototype.twice = function () {
  return this.x * 2;
};
function Heir(x, y) {
  var made = Base.call(this, x) || this;
  made.y = y;
  return made;
}
Heir.prototype.sum = function () {
  return this.x + this.y;
};
for (var key in Base.prototype) Heir.prototype[key] = Base.prototype[key];
Heir.prototype.constructor = Heir;
console.log(new Heir(1, 2).twice(), new Heir(1, 2).sum());
delete Base.prototype.twice;
try {
  console.log(new Base(8).twice());
} catch (error) {
  console.log(error instanceof TypeError ? "TypeError" : "another error");
}
console.log(new Heir(3, 4).twice());
