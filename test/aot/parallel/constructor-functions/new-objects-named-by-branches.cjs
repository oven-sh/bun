// `this || other` and `value || other` name the object that is being made, and show it before its fields are filled.
const said = [];
function see(value) {
  return typeof value.size;
}
function seeEither(value) {
  const either = value || 0;
  return typeof either.size;
}
function Passed(value) {
  said.push(see(this || value));
  this.size = "a" + value;
}
class Coalesced {
  constructor(value) {
    said.push(String((this ?? value).size?.inner));
    this.size = { inner: value };
  }
}
function Read(value) {
  const self = this || value;
  const kind = typeof self.size;
  this.size = value + 0.5;
  this.kind = kind;
}
function Callee(value) {
  said.push(seeEither(this));
  this.size = [value];
}
let last;
class Kept {
  constructor(value) {
    last = this || value;
    this.look();
    this.size = value > 1;
  }
  look() {
    said.push(typeof last.size);
  }
}
function Negated(value) {
  const either = !this || this;
  said.push(see(either));
  this.size = () => value;
}
for (const value of [1, 2]) {
  for (const made of [new Passed(value), new Coalesced(value), new Read(value), new Callee(value), new Kept(value), new Negated(value)]) said.push(typeof made.size, String(made.kind));
}
console.log(said.join(" "));
