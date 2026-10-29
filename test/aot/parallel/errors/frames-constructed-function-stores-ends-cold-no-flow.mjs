// A function that stores to `this` and ends in a call is constructed. Only a frame whose function was constructed says `new`. The frames of the constructed functions themselves are left out.
// Flags: --aot-heat=everything-is-cold --aot-disable=flow-results
const isForwarder = /^(?:new )?Forward\w*$/;
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
const table = [declared, arrow];
function thrower() {
  throw new TypeError("thrown");
}
function returnsNumber() {
  seen = frames(new Error("trace").stack);
  return 1;
}
let seen = "";

function ForwardToDeclared(value) {
  this.value = value;
  return declared(value);
}
function ForwardToArrow(value) {
  this.value = value;
  return arrow(value);
}
function ForwardToMethod(value) {
  this.value = value;
  return holder.method(value);
}
function ForwardByValue(value) {
  this.value = value;
  return table[value & 1](value);
}
function ForwardToThrower(value) {
  this.value = value;
  return thrower(value);
}
function ForwardToNumber(value) {
  this.trace = "kept";
  return returnsNumber(value);
}
function ForwardTwice(value) {
  this.value = value;
  return ForwardToDeclared.call(this, value);
}
function ForwardEitherWay(value) {
  this.value = value;
  return value ? declared(value) : arrow(value);
}
function ForwardWithThis(value) {
  return receives(this, value);
}
function receives(receiver, value) {
  receiver.value = value;
  return trace();
}
function ForwardLong(value) {
  this.a = value;
  this.b = value + 1;
  this.c = value + 2;
  this.d = value + 3;
  this.e = value + 4;
  this.f = value + 5;
  this.g = value + 6;
  this.h = value + 7;
  this.i = this.a + this.b;
  this.j = this.c + this.d;
  this.k = this.e + this.f;
  this.l = this.g + this.h;
  this.m = this.i + this.j;
  this.n = this.k + this.l;
  this.o = this.m * this.n;
  this.p = this.o - this.a;
  this.q = this.p - this.b;
  this.r = this.q - this.c;
  this.s = this.r - this.d;
  this.t = this.s - this.e;
  return declared(this.t);
}
ForwardToDeclared.prototype.describe = function () {
  return "described";
};

const forwarders = [
  ForwardToDeclared,
  ForwardToArrow,
  ForwardToMethod,
  ForwardByValue,
  ForwardToThrower,
  ForwardToNumber,
  ForwardTwice,
  ForwardEitherWay,
  ForwardWithThis,
  ForwardLong,
];
function Other() {}
const construct = Reflect.construct;
const ways = {
  called: callee => callee.call({}, 1),
  constructed: callee => new callee(1),
  "without arguments": callee => new callee(),
  spread: callee => new callee(...[1]),
  reflected: callee => Reflect.construct(callee, [1]),
  "reflected for another": callee => Reflect.construct(callee, [1], Other),
  "reflected through a variable": callee => construct(callee, [1]),
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
    seen = "";
    try {
      answer = run(callee).trace;
    } catch (error) {
      answer = "threw " + frames(error.stack);
    }
    console.log(callee.name + ", " + way + ": " + answer + (seen && " | " + seen));
  }
}

class ChildOfDeclared extends ForwardToDeclared {}
class ChildOfThrower extends ForwardToThrower {
  constructor(value) {
    super(value);
  }
}
class GrandChild extends ChildOfDeclared {
  constructor(value) {
    super(value);
  }
}
console.log("a written parent: " + new ChildOfDeclared(1).trace);
console.log("a written grandparent: " + new GrandChild(1).trace);
try {
  new ChildOfThrower(1);
} catch (error) {
  console.log("a written parent that throws: " + frames(error.stack));
}
console.log("written: " + new ForwardToDeclared(1).trace + " | " + ForwardToDeclared.call({}, 1).trace);
console.log("written, bound: " + new (ForwardToDeclared.bind(null))(1).trace);
console.log("written, through a variable: " + construct(ForwardToDeclared, [1]).trace);
console.log("written, long: " + new ForwardLong(1).trace + " | " + construct(ForwardLong, [1]).trace);
for (let i = 0; i < 3; i++) console.log("in a loop: " + new ForwardEitherWay(i).trace);
