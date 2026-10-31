// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const show = value =>
  Object.is(value, -0)
    ? "-0"
    : typeof value === "string" || (typeof value === "object" && value !== null)
      ? JSON.stringify(value)
      : String(value);
const report = (label, probe) => {
  let text;
  try {
    text = show(probe());
  } catch (error) {
    text = "threw " + error.constructor.name;
  }
  console.log(label + ": " + text);
};
function self() {
  return this;
}
function strictSelf() {
  "use strict";
  return this;
}
function callOn(f, receiver) {
  return f.call(receiver);
}
function valueOf(receiver) {
  return Object.prototype.valueOf.call(receiver);
}
function collect(iterable) {
  const seen = [];
  for (const value of iterable) seen.push(value);
  return seen;
}
function* countUp() {
  yield 1;
  yield 2;
}
function* countDown() {
  yield 2;
  yield 1;
}
let steps = 0;
countUp.prototype.next = function () {
  return ++steps > 2 ? { done: true, value: undefined } : { done: false, value: "own next " + steps };
};
report("sloppy, no receiver", () => self() === globalThis);
report("sloppy, undefined", () => [self.call(undefined) === globalThis, callOn(self, undefined) === globalThis]);
report("sloppy, null", () => [self.call(null) === globalThis, callOn(self, null) === globalThis]);
report("sloppy, 5", () => [typeof self.call(5), self.call(5) == 5, typeof callOn(self, 5), callOn(self, 5) == 5]);
report("sloppy, s", () => [typeof self.call("s"), typeof callOn(self, "s"), callOn(self, "s") == "s"]);
report("strict, no receiver", () => strictSelf());
report("strict, direct", () => [strictSelf.call(undefined), strictSelf.call(null), strictSelf.call(5)].map(show));
report("strict", () => [undefined, null, 5, "s"].map(receiver => show(callOn(strictSelf, receiver))));
report("valueOf of null", () => valueOf(null));
report("valueOf of undefined", () => valueOf(undefined));
report("valueOf of a number", () => [typeof valueOf(5), valueOf(5) == 5]);
report("own next", () => collect(countUp()));
report("original next", () => collect(countDown()));
