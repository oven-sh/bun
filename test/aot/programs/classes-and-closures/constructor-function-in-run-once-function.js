// A constructor function declared in a function that runs once has one prototype, whose method captures a local of that function. `new`, `Object.getPrototypeOf` and `Reflect.construct` with another `new.target` agree on which prototype an instance gets.
function describe(label, instance, constructor) {
  const prototype = Object.getPrototypeOf(instance);
  const which = prototype === constructor.prototype ? "the constructor's prototype" : prototype === Object.prototype ? "Object.prototype" : "another prototype";
  console.log(label, which, JSON.stringify(instance), instance instanceof constructor, "m" in instance ? instance.m() : "no m");
}

function runOnce() {
  const captured = 41;
  function P() {
    this.x = 1;
  }
  P.prototype.m = function () {
    return captured + this.x;
  };

  console.log(new P().m());
  console.log(Object.getPrototypeOf(new P()) === P.prototype);
  describe("new.target is Object:", Reflect.construct(P, [], Object), P);
  describe("new.target is P:", Reflect.construct(P, [], P), P);
  describe("Object with new.target P:", Reflect.construct(Object, [], P), P);

  function Other() {}
  Other.prototype.m = function () {
    return "other " + (captured + this.x);
  };
  describe("new.target is another function:", Reflect.construct(P, [], Other), P);

  function WithoutPrototypeObject() {}
  WithoutPrototypeObject.prototype = 1;
  describe("the prototype of new.target is a number:", Reflect.construct(P, [], WithoutPrototypeObject), P);

  console.log(P.prototype.constructor === P, Object.keys(P.prototype).join(), Object.getPrototypeOf(P.prototype) === Object.prototype);
  return P;
}

const P = runOnce();
describe("outside the function:", new P(), P);

function runTwice(captured) {
  function Q() {
    this.x = 1;
  }
  Q.prototype.m = function () {
    return captured + this.x;
  };
  describe("new.target is Object:", Reflect.construct(Q, [], Object), Q);
  return Q;
}

const first = runTwice(10);
const second = runTwice(20);
console.log(first === second, first.prototype === second.prototype);
describe("the first closure:", new first(), first);
describe("the second closure:", new second(), second);
describe("the second closure against the first:", new second(), first);
describe("the first closure with new.target the second:", Reflect.construct(first, [], second), second);
