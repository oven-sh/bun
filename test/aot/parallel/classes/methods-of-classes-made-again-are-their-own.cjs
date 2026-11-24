"use strict";
// A class that a function makes each time it runs has methods of its own each time, also where some instance hides one with a field.
const tell = (name, ...rest) => console.log(name, ...rest.map(x => (typeof x === "function" ? "function " + x.name : x)));
function compared(hides) {
  class Gauge {
    read() { return 1; }
    reset() { return 2; }
  }
  const left = new Gauge(), right = new Gauge();
  if (hides) left.read = 5;
  return [right.read === Gauge.prototype.read, right.reset === Gauge.prototype.reset, right.read === Object.getPrototypeOf(right).read, (hides ? right : left).read === Gauge.prototype.read];
}
for (const hides of [false, true, true, false, true]) tell("compared", ...compared(hides));
function always() {
  class Gauge {
    read() { return 1; }
  }
  const left = new Gauge(), right = new Gauge(), other = new Gauge();
  left.read = () => -1;
  return [right.read === Gauge.prototype.read, right.read === other.read, left.read === Gauge.prototype.read, new Set([right.read, Gauge.prototype.read, other.read]).size, new WeakMap([[Gauge.prototype.read, "yes"]]).get(right.read), [right.read].indexOf(Gauge.prototype.read), Object.is(right.read, Gauge.prototype.read)];
}
for (let k = 0; k < 3; k++) tell("always", ...always());
function marked(k) {
  class Gauge {
    read() { return 1; }
  }
  const left = new Gauge(), right = new Gauge();
  left.read = k;
  Gauge.prototype.read.mark = k;
  const before = right.read.mark;
  right.read.other = k * 2;
  return [before, Gauge.prototype.read.other, Object.keys(right.read).join()];
}
for (let k = 1; k < 4; k++) tell("marked", ...marked(k));
function inLoops(n) {
  class Gauge {
    read(by) { return by + 1; }
  }
  const left = new Gauge(), right = new Gauge(), all = [left, right];
  left.read = right.read;
  let text = "", sum = 0, last;
  for (let i = 0; i < n; i++) {
    const gauge = all[i % 2];
    text += gauge.read === Gauge.prototype.read ? "a" : "b";
    sum += gauge.read(i);
    last = gauge.read;
  }
  return [text, sum, last === Gauge.prototype.read];
}
for (const n of [4, 7, 24, 60]) tell("inLoops", ...inLoops(n));
for (let q = 0; q < 3; q++) {
  class Gauge {
    read() { return q; }
    peek() { return 9; }
  }
  const left = new Gauge(), right = new Gauge();
  left.peek = left.read = null;
  tell("block", right.read === Gauge.prototype.read, right.peek === Gauge.prototype.peek, right.read(), right.peek());
}
const makes = () => class {
  read() { return 3; }
  *steps() { yield 1; yield 2; }
  async later() { return 4; }
};
const made = [];
for (let q = 0; q < 3; q++) {
  const Gauge = makes(), left = new Gauge(), right = new Gauge();
  left.read = left.steps = left.later = undefined;
  made.push(right.read, right.steps, right.later);
  tell("made", right.read === Gauge.prototype.read, right.steps === Gauge.prototype.steps, right.later === Gauge.prototype.later, [...right.steps()].join(), Object.getPrototypeOf(right.steps()) === Gauge.prototype.steps.prototype, right.read());
}
tell("made", new Set(made).size);
class Once {
  read() { return 6; }
}
function once() {
  const left = new Once(), right = new Once();
  left.read = 5;
  return [right.read === Once.prototype.read, right.read(), left.read];
}
for (let k = 0; k < 3; k++) tell("once", ...once());
function heirs(k) {
  class Gauge {
    read() { return 1; }
  }
  class Wide extends Gauge {
    other() { return k; }
  }
  const left = new Wide(), right = new Wide(), base = new Gauge();
  left.read = k;
  return [right.read === Gauge.prototype.read, base.read === Gauge.prototype.read, right.read === base.read, right.read === Wide.prototype.read, right.other === Wide.prototype.other];
}
for (let k = 0; k < 3; k++) tell("heirs", ...heirs(k));
