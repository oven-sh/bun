// A constructor defines an accessor on the object that it makes, and a half runs before every field is filled.
"use strict";
const lines = [];
function show(value) {
  return typeof value === "object" && value ? Object.keys(value).join("/") : typeof value + String(value);
}
class Reads {
  constructor(a) {
    Object.defineProperty(this, "size", { get() { return this.w; }, enumerable: true });
    this.last = this.size;
    this.w = a;
  }
}
class Stores {
  constructor(a) {
    Object.defineProperty(this, "size", { get() { return this.w; }, set(x) { this.seen = show(this.w); this.w = x; } });
    this.size = 5;
    this.last = this.w;
    this.w = a;
  }
}
class Updates {
  constructor(a) {
    this.n = 1;
    Object.defineProperty(this, "size", { get() { return this.n; }, set(x) { this.m = x; } });
    this.size++;
    this.w = a;
  }
}
class Base {
  constructor() {
    Object.defineProperty(this, "size", { get() { return [this.w, this.h].map(show).join("+"); }, configurable: true });
  }
}
class Heir extends Base {
  constructor(a) {
    super();
    this.last = this.size;
    this.w = a;
    this.h = [a];
  }
}
class HeirWithField extends Base {
  last = this.size;
  h = "h";
  w = this.size;
}
class Spreads {
  constructor(a) {
    Object.defineProperty(this, "size", { get() { return show(this.w); }, enumerable: true });
    this.last = { ...this }.size;
    this.w = a;
  }
}
class Destructures {
  constructor(a) {
    Object.defineProperty(this, "size", { get() { return this.w; }, enumerable: true });
    const { size, ...rest } = this;
    this.last = show(size) + Object.keys(rest);
    this.w = a;
  }
}
class Sometimes {
  constructor(a) {
    Object.defineProperty(this, "size", { get() { return this.w; } });
    if (a > 1) this.last = this.size;
    this.w = a;
  }
}
function runReads() {
  let text = "";
  for (let i = 0; i < 4; i++) {
    const one = new Reads(i & 1 ? i : "text" + i);
    text += [one.size, one.last, one.w, one.h, one.seen, one.m].map(show).join() + ";";
  }
  return text;
}
function runStores() {
  let text = "";
  for (let i = 0; i < 4; i++) {
    const one = new Stores(i & 1 ? i : "text" + i);
    text += [one.size, one.last, one.w, one.h, one.seen, one.m].map(show).join() + ";";
  }
  return text;
}
function runUpdates() {
  let text = "";
  for (let i = 0; i < 4; i++) {
    const one = new Updates(i & 1 ? i : "text" + i);
    text += [one.size, one.last, one.w, one.h, one.seen, one.m].map(show).join() + ";";
  }
  return text;
}
function runHeir() {
  let text = "";
  for (let i = 0; i < 4; i++) {
    const one = new Heir(i & 1 ? i : "text" + i);
    text += [one.size, one.last, one.w, one.h, one.seen, one.m].map(show).join() + ";";
  }
  return text;
}
function runHeirWithField() {
  let text = "";
  for (let i = 0; i < 4; i++) {
    const one = new HeirWithField(i & 1 ? i : "text" + i);
    text += [one.size, one.last, one.w, one.h, one.seen, one.m].map(show).join() + ";";
  }
  return text;
}
function runSpreads() {
  let text = "";
  for (let i = 0; i < 4; i++) {
    const one = new Spreads(i & 1 ? i : "text" + i);
    text += [one.size, one.last, one.w, one.h, one.seen, one.m].map(show).join() + ";";
  }
  return text;
}
function runDestructures() {
  let text = "";
  for (let i = 0; i < 4; i++) {
    const one = new Destructures(i & 1 ? i : "text" + i);
    text += [one.size, one.last, one.w, one.h, one.seen, one.m].map(show).join() + ";";
  }
  return text;
}
function runSometimes() {
  let text = "";
  for (let i = 0; i < 4; i++) {
    const one = new Sometimes(i & 1 ? i : "text" + i);
    text += [one.size, one.last, one.w, one.h, one.seen, one.m].map(show).join() + ";";
  }
  return text;
}
lines.push(runReads(), runStores(), runUpdates(), runHeir(), runHeirWithField(), runSpreads(), runDestructures(), runSometimes());
class Counts {
  constructor(a) {
    Object.defineProperty(this, "size", { get() { return this.w; }, enumerable: true });
    this.last = this.size;
    this.w = a;
  }
}
class HeirThatCounts extends Counts {
  x = this.size;
}
function count() {
  let sum = 0;
  for (let i = 0; i < 50; i++) {
    const one = new Counts(i);
    sum += one.size + (one.last === undefined ? 1 : 100);
  }
  return sum;
}
lines.push(count(), show(new Counts("a").last), new Counts(2).size, new HeirThatCounts(3).x);
console.log(lines.join("\n"));
