// `Derived.prototype = new Base(7)`: what the prototype object is, has and answers, seen from every side.
function Base(size) {
  this.size = size;
  this.tags = ["a"];
}
Base.prototype.describe = function () {
  return "base " + this.size;
};
function Derived(size) {
  Base.call(this, size);
  this.extra = true;
}
const constructorBefore = Derived.prototype.constructor === Derived;
Derived.prototype = new Base(7);
const constructorBetween = Derived.prototype.constructor === Base;
Derived.prototype.constructor = Derived;
Derived.prototype.describe = function () {
  return "derived " + this.size;
};
const made = new Derived(1);
const plain = new Base(2);
const names = object => {
  const found = [];
  for (const name in object) found.push(name);
  return found.join();
};
console.log(constructorBefore, constructorBetween, Derived.prototype.constructor === Derived, made.constructor === Derived, plain.constructor === Base);
console.log(made instanceof Derived, made instanceof Base, plain instanceof Derived, Derived.prototype instanceof Base, Derived.prototype instanceof Derived);
console.log(Object.getPrototypeOf(made) === Derived.prototype, Object.getPrototypeOf(Derived.prototype) === Base.prototype, Object.getPrototypeOf(Base.prototype) === Object.prototype);
console.log(Base.prototype.isPrototypeOf(Derived.prototype), Derived.prototype.isPrototypeOf(made), Derived.prototype.isPrototypeOf(plain));
console.log(names(made), "|", names(Derived.prototype), "|", names(plain));
console.log(Object.keys(Derived.prototype).join(), "|", Object.getOwnPropertyNames(Derived.prototype).join(), "|", Object.keys(made).join());
console.log(Derived.prototype.hasOwnProperty("size"), Derived.prototype.hasOwnProperty("describe"), Derived.prototype.hasOwnProperty("extra"), made.hasOwnProperty("describe"));
console.log(JSON.stringify(made), JSON.stringify(Derived.prototype), JSON.stringify(plain));
console.log(made.describe(), plain.describe(), Derived.prototype.describe(), Base.prototype.describe.call(made));
console.log(made.tags === Derived.prototype.tags, Object.prototype.toString.call(Derived.prototype), typeof Derived.prototype, delete made.size, made.size);
