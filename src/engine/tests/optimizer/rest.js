// A rest parameter is an array as soon as something could tell.

function expect(f, args, expected) {
  for (let turn = 0; turn < 60; turn++) {
    const actual = outcome(f, args);
    if (actual !== expected) throw new Error(`${f}\nturn ${turn}: ${actual} instead of ${expected}`);
  }
}
var all = function () {
  return [this === undefined || this === globalThis ? "none" : this, ...Array.from(arguments)];
};
var far = new Proxy(all, {});
class Counts {
  constructor(...values) {
    this.count = values.length;
    this.last = values[values.length - 1];
  }
}
globalThis.Counts = Counts;
const counts = () => [[], [1], [1, 2], [1, 2, 3], ["a", 0.5, {}, null, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]];

for (const callee of ["all", "far"])
  for (const call of [
    "f(...rest)", "f(a, ...rest)", "f(...rest, a)", "f(...rest, ...rest)", "f.call(a, ...rest)", "f.call(a, 0, ...rest)",
    "f.call(...rest)", "f.apply(a, rest)", "f(...arguments)", "f(...arguments, ...rest)", "f(...rest, ...arguments)",
    "Reflect.apply(f, a, rest)", "[...rest]", "[a, ...rest]", "f(...rest, rest.push(1))", "f(rest.push(1), ...rest)",
  ]) {
    const text = call.replace(/\bf\b/, callee);
    check(`function (a, ...rest) { return ${text}; }`, counts);
    checkInTurn(`function (a, ...rest) { const result = ${text}; return result; }`, counts);
    checkInTurn(`function () { "use strict"; const inner = function (a, ...rest) { return ${text}; }; return [inner(...arguments), inner(1), inner(1, 2, 3)]; }`, counts);
  }
for (const text of ["new Counts(...rest)", "new Counts(a, ...rest)", "Reflect.construct(Counts, rest)", "Reflect.construct(Counts, rest, Object)"])
  checkInTurn(`(a, ...rest) => ${text}`, counts);
checkInTurn(`(...outer) => new (class extends Counts { constructor(a, ...rest) { super(...rest); } })(...outer)`, counts);
for (const key of ["0", "1", "2", "-1", "1.5", "-0", '"0"', '"length"', "a", "rest.length - 1", "rest.length", "rest.push(9) - 1"]) {
  check(`(a, ...rest) => [rest[${key}], rest.length]`, counts);
  checkInTurn(`(a, b = 1, ...rest) => { a = b = 7; return [rest[${key}], rest.length]; }`, counts);
}
checkInTurn((a, ...rest) => { if (a === "a") rest.length = 1; return [rest.length, rest[0], rest[1], all(...rest), all.apply(a, rest)]; }, counts);
checkInTurn((a, ...rest) => { let sum = ""; for (let i = 0; i < rest.length; i++) { sum += rest[i]; if (i === 1) rest[2] = "x"; } return sum; }, counts);
checkInTurn((a, ...rest) => { const seen = []; for (let i = 0; i < 2; i++) seen.push(rest); return seen[0] === seen[1]; }, counts);
checkInTurn((a, ...rest) => { try { if (a) far(rest).no.such; } catch { rest.push(1); } return [rest.length, rest]; }, counts);
checkInTurn((a, ...rest) => { switch (rest.length) { case 0: return far(); case 1: return far(rest[0]); default: return far.apply(a, rest); } }, counts);

expect((a, ...rest) => all(a, ...rest), [1, 2, 3], '["none",1,2,3]');
expect((a, ...rest) => all.call(a, 0, ...rest), ["t", 2], '["t",0,2]');
expect((a, ...rest) => all(...rest, rest.pop()), [1, 2, 3], '["none",2,3,3]');
expect((...rest) => ({ apply: (self, list) => Array.isArray(list) && list === rest }).apply(0, rest), [1], "true");
expect((...rest) => ({ call: (...got) => got }).call(0, ...rest), [1, 2], "[0,1,2]");
expect((...rest) => { var rest; return rest; }, [1], "[1]");
expect((...rest) => { var rest = 5; return rest.length; }, [1], "undefined");
expect((...rest) => { function rest() {} return typeof rest; }, [1], '"function"');
expect((...rest) => { rest = [7, 8]; return all(...rest); }, [1], '["none",7,8]');
expect((...rest) => (() => rest.length)(), [1, 2], "2");
expect((...rest) => eval("rest.push(0)") + rest.length, [1], "4");
expect((a = rest, ...rest) => rest, [], "threw ReferenceError: Cannot access 'rest' before initialization.");
expect((...rest) => { { let rest = [1, 2, 3]; return rest.length; } }, [], "3");
expect((...rest) => typeof rest + (delete rest[0]) + rest[0], [1], '"objecttrueundefined"');
expect((...rest) => (function* (...own) { yield; yield own.length + own[0]; })(...rest).toArray(), [3, 4], "[null,5]");

{
  const join = function () { return Array.prototype.join.call(arguments); };
  const spread = (a, ...rest) => join(...rest), index = (a, ...rest) => rest[1], viaArguments = function () { return join(...arguments); };
  expect(spread, [1, 2], '"2"');
  expect(index, [1, 2], "undefined");
  expect(() => viaArguments(2), [], '"2"');
  Array.prototype[1] = "inherited";
  expect(index, [1, 2], '"inherited"');
  Array.prototype.length = 0;
  const values = Array.prototype[Symbol.iterator];
  Array.prototype[Symbol.iterator] = function () { return values.call(this.length === 1 && this[0] === 2 ? ["other"] : this); };
  expect(spread, [1, 2], '"other"');
  expect(() => viaArguments(2), [], '"2"');
  Array.prototype[Symbol.iterator] = values;
  const prototype = Object.getPrototypeOf([].values()), next = prototype.next;
  prototype.next = function () { const step = next.call(this); return step.value === 2 && new Error().stack.includes("viaArguments") ? { value: 3 } : step; };
  expect(() => viaArguments(2), [], '"3"');
}
