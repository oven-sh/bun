// `Derived.prototype = new Base(next())`: what the constructor does beside filling the object happens once, there, in order, and to that object.
const log = [];
const registry = [];
let count = 0;
function next() {
  log.push("argument");
  return ++count;
}
function Base(id) {
  log.push("enter " + id);
  Base.made++;
  registry.push(this);
  this.id = id;
  this.seenConstructor = this.constructor === Base;
  this.read = function () {
    return id + this.id;
  };
  log.push("leave " + id);
}
Base.made = 0;
function Derived(id) {
  Base.call(this, id);
}
log.push("before");
Derived.prototype = new Base(next());
log.push("after");
const one = new Derived(next());
const two = new Base(next());
console.log(log.join(" . "));
console.log(Base.made, registry.length, registry[0] === Derived.prototype, registry[1] === one, registry[2] === two);
console.log(Derived.prototype.seenConstructor, one.seenConstructor, two.seenConstructor, Derived.prototype.read(), one.read(), two.read(), one.read === Derived.prototype.read);
