// A function that ends in a call is constructed. Only a frame whose function was constructed says `new`. The frames of the constructed functions themselves are left out.
const isForwarder = /^(?:new )?forward\w*$/;
const nameOf = line => /^\s+at ((?:new )?[\w$.<>]+)(?: \(|$)/.exec(line)?.[1];
const frames = stack =>
  stack
    .split("\n")
    .slice(1)
    .map(nameOf)
    .filter(name => name && !isForwarder.test(name))
    .slice(0, 3)
    .join(" < ");
const trace = () => ({ trace: frames(new Error("trace").stack) });

function declared() {
  return trace();
}
const arrow = () => trace();
const holder = {
  method() {
    return trace();
  },
};
class Holder {
  static method() {
    return trace();
  }
}
const bound = function inner() {
  return trace();
}.bind(null);
const table = [declared, arrow];
function Made() {
  this.trace = frames(new Error("trace").stack);
}
function thrower() {
  throw new TypeError("thrown");
}
class Class {}

function forwardToDeclared(value) {
  return declared(value);
}
function forwardToArrow(value) {
  return arrow(value);
}
function forwardToMethod(value) {
  return holder.method(value);
}
function forwardToStatic(value) {
  return Holder.method(value);
}
function forwardToBound(value) {
  return bound(value);
}
function forwardByValue(value) {
  return table[value & 1](value);
}
function forwardToThrower(value) {
  return thrower(value);
}
function forwardToClass(value) {
  return Class(value);
}
function forwardToConstruction(value) {
  return makes(value);
}
function makes(value) {
  return new Made(value);
}
function forwardTwice(value) {
  return forwardToDeclared(value);
}
function forwardThrice(value) {
  return forwardTwice(value);
}
function forwardEitherWay(value) {
  return value ? declared(value) : arrow(value);
}
function forwardAfterWork(value) {
  if (value < 0) return null;
  return declared(value + 1);
}
function forwardRest(...values) {
  return declared(...values);
}
function forwardArguments() {
  return declared(arguments[0]);
}
function forwardDefault(value = 1) {
  return declared(value);
}
function forwardManyParameters(a, b, c, d, e, f, g, h, i, j) {
  return declared(j);
}
function forwardReadingNewTarget(value) {
  return new.target ? declared(value) : arrow(value);
}
const forwardFromFactory = (extra =>
  function forwardInner(value) {
    return declared(value + extra);
  })(1);

const forwarders = [
  forwardToDeclared,
  forwardToArrow,
  forwardToMethod,
  forwardToStatic,
  forwardToBound,
  forwardByValue,
  forwardToThrower,
  forwardToClass,
  forwardToConstruction,
  forwardTwice,
  forwardThrice,
  forwardEitherWay,
  forwardAfterWork,
  forwardRest,
  forwardArguments,
  forwardDefault,
  forwardManyParameters,
  forwardReadingNewTarget,
  forwardFromFactory,
];
function Other() {}
const ways = {
  called: callee => callee(1),
  constructed: callee => new callee(1),
  "without arguments": callee => new callee(),
  "with many arguments": callee => new callee(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12),
  spread: callee => new callee(...[1]),
  reflected: callee => Reflect.construct(callee, [1]),
  "reflected for another": callee => Reflect.construct(callee, [1], Other),
  "out of a field": callee => new { callee }.callee(1),
  bound: callee => new (callee.bind(null))(1),
  "behind a proxy": callee => new new Proxy(callee, {})(1),
  "as a parent": callee => new (class Child extends callee {})(1),
  "as a parent that is handed arguments": callee =>
    new (class Child extends callee {
      constructor(value) {
        super(value);
      }
    })(1),
};
for (const callee of forwarders) {
  for (const [way, run] of Object.entries(ways)) {
    let answer;
    try {
      answer = run(callee).trace;
    } catch (error) {
      answer = "threw " + frames(error.stack);
    }
    console.log(callee.name + ", " + way + ": " + answer);
  }
}

console.log("written: " + new forwardToDeclared(1).trace + " | " + forwardToDeclared(1).trace);
console.log("written, twice: " + new forwardTwice(1).trace + " | " + forwardTwice(1).trace);
console.log("written, by value: " + new forwardByValue(1).trace + " | " + forwardByValue(1).trace);
function Outer(value) {
  this.trace = new forwardToDeclared(value).trace;
}
console.log("inside a construction: " + new Outer(1).trace);
function returnsConstruction(value) {
  return new forwardToDeclared(value);
}
console.log("behind a return: " + returnsConstruction(1).trace);
for (let i = 0; i < 3; i++) console.log("in a loop: " + new forwardEitherWay(i).trace);
