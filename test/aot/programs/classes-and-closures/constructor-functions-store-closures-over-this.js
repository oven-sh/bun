// Closures over `this` that a constructor function stores: one function is only constructed, one is also called on an object that exists, one is called by its subclass in the ES5 way.
function OnlyConstructed(seed) {
  this.seed = seed;
  this.read = () => this.seed;
  this.self = () => this;
  this.after = seed + 1;
}
function CalledAgain(seed) {
  this.seed = seed;
  this.read = () => this.seed;
}
function Parent(seed) {
  this.seed = seed;
  this.read = () => this.seed;
}
function Child(seed) {
  Parent.call(this, seed);
  this.twice = () => this.seed * 2;
}
Child.prototype = Object.create(Parent.prototype);

const kept = [];
let sum = 0, previous = null;
for (let i = 0; i < 3000; i++) {
  const made = new OnlyConstructed(i);
  if (i % 5 === 0) sum += made.read() + made.after;
  if (i % 7 === 0) kept.push(made.read);
  if (made.read !== made.read || made.self() !== made) sum += 1e9;
  if (previous && previous.read === made.read) sum += 1e9;
  previous = made;
}
for (const read of kept) sum += read();
console.log(sum, kept.length, Object.keys(previous).join(), previous.read.name, previous.read.length);

const again = new CalledAgain(1);
const first = again.read;
CalledAgain.call(again, 2);
console.log(first === again.read, first(), again.read(), again.seed);

const child = new Child(21);
const readOfChild = child.read;
Parent.call(child, 22);
console.log(readOfChild === child.read, readOfChild(), child.twice(), Object.keys(child).join());
