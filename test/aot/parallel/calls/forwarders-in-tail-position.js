// `return f.apply(this, arguments)` and its relatives, where the call has to stay a tail call: what is passed on, who `this` is, what happens when `apply` is not the built-in,
// and that a chain of such calls needs no stack.
"use strict";
const lines = [];
function show(label, value) {
  lines.push(label + ": " + String(value));
}

function describe() {
  return (this === undefined ? "no this" : this.name) + " [" + Array.prototype.join.call(arguments, ",") + "]";
}

function forwardArguments(f) {
  return f.apply(this, arguments);
}
function forwardRest(f, ...rest) {
  return f.apply(this, rest);
}
function forwardWithoutFirst(f) {
  return f.apply(this, Array.prototype.slice.call(arguments, 1));
}
function forwardChanged(f, a) {
  arguments[1] = "changed";
  return f.apply(this, arguments);
}
function forwardNothing(f) {
  return f.apply(this);
}
function forwardNull(f) {
  return f.apply(this, null);
}
function forwardArrayLike(f, list) {
  return f.apply(this, list);
}
function forwardByCall(f, a, b) {
  return f.call(this, a, b);
}
function forwardByReflect(f) {
  return Reflect.apply(f, this, arguments);
}

const forwarders = { forwardArguments, forwardRest, forwardWithoutFirst, forwardChanged, forwardNothing, forwardNull, forwardByCall, forwardByReflect };
const owner = { name: "owner" };
for (const name of Object.keys(forwarders)) {
  const forwarder = forwarders[name];
  const text = (value) => String(value).replace(/function[^]*?\}/g, "describe");
  show(name, text(forwarder(describe, 1, 2, 3)));
  show(name + " with this", text(forwarder.call(owner, describe, 1, 2, 3)));
  show(name + " with one argument", text(forwarder(describe)));
}
show("array-like", forwardArrayLike(describe, { length: 2, 0: "x", 1: "y" }));
show("array with a hole", forwardArrayLike(describe, [1, , 3]));
show("typed array", forwardArrayLike(describe, new Uint8Array([7, 8])));

function attempt(label, action) {
  try {
    show(label, action());
  } catch (error) {
    show(label, error instanceof TypeError ? "TypeError" : error);
  }
}
attempt("list that is no object", () => forwardArrayLike(describe, 5));
attempt("callee without apply", () => forwardArguments({ name: "plain" }));
attempt("callee that is undefined", () => forwardArguments(undefined));
attempt("apply of something that cannot be called", () => forwardArguments({ apply: Function.prototype.apply }));

function withOwnApply() {
  return "called";
}
withOwnApply.apply = function (thisValue, list) {
  return "own apply with " + list.length + " arguments";
};
show("own apply", forwardArguments(withOwnApply, 1, 2));
show("own apply and a rest parameter", forwardRest(withOwnApply, 1, 2));
const notAFunction = {
  apply(thisValue, list) {
    return "apply of an object with " + list.length;
  },
};
show("apply of an object", forwardArguments(notAFunction, 1));

const bound = describe.bind(owner, "bound");
show("bound function", forwardRest(bound, 1, 2));
show("arrow function", forwardRest((...values) => values.length, 1, 2, 3));
show("built-in", forwardRest(Math.max, 1, 9, 3));
class Point {
  constructor(x) {
    this.x = x;
  }
}
attempt("class constructor", () => forwardRest(Point, 1));

function countDown(f, n, total) {
  if (n === 0) return total;
  arguments[1] = n - 1;
  arguments[2] = total + n;
  return f.apply(this, arguments);
}
show("chain through arguments", countDown(countDown, 200000, 0));
function countDownWithRest(f, ...rest) {
  if (rest[0] === 0) return rest[1];
  return f.apply(this, [f, rest[0] - 1, rest[1] + rest[0]]);
}
show("chain through a rest parameter", countDownWithRest(countDownWithRest, 200000, 0));
function hop(f, n) {
  return n === 0 ? "landed" : forwardRest(f, f, n - 1);
}
show("chain through a forwarder", hop(hop, 200000));

console.log(lines.join("\n"));
