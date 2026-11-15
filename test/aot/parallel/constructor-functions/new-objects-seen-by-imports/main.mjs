// A constructor passes its new object to an imported function before it fills a field: the field is empty there.
import { see, readFirst, keep, kept } from "./seen.mjs";
import * as all from "./seen.mjs";
const said = [];
function Record(value) {
  said.push(see(this));
  this.size = { inner: value };
}
function Text(value) {
  said.push(String(readFirst(1, this)));
  this.size = "a" + value;
}
function Kept(value) {
  said.push(String(keep(this)));
  this.size = value + 0.5;
}
class Parent {
  constructor(value) {
    if (value > 1) said.push(all.see(this));
    this.size = [value];
  }
}
class Heir extends Parent {
  constructor(value) {
    super(value);
    this.own = value;
  }
}
function Chosen(value) {
  const self = value > 1 ? this : this;
  said.push(see(self));
  this.size = value;
}
for (const value of [1, 2, 3]) {
  for (const made of [new Record(value), new Text(value), new Kept(value), new Heir(value), new Chosen(value)]) said.push(typeof made.size);
}
console.log(said.join(" "), kept.length);
