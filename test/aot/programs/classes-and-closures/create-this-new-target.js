// Allocating `this` from new.target: a prototype read that throws, a revoked proxy, a prototype that is not an object.
function errorText(run) {
  try {
    return "returned " + String(run());
  } catch (error) {
    return error.constructor.name;
  }
}

function F() {
  this.x = 1;
  this.target = new.target;
}

const throwingTarget = new Proxy(function () {}, {
  get(callee, key) {
    console.log("get", String(key));
    if (key === "prototype") throw new RangeError("no prototype");
    return callee[key];
  },
});
console.log("throwing get trap:", errorText(() => Reflect.construct(F, [], throwingTarget)));

const { proxy: revoked, revoke } = Proxy.revocable(function () {}, {});
revoke();
console.log("revoked new.target:", errorText(() => Reflect.construct(F, [], revoked)));

function NumberPrototype() {}
NumberPrototype.prototype = 5;
const fromNumber = new NumberPrototype();
console.log("number prototype:", Object.getPrototypeOf(fromNumber) === Object.prototype);
const fromNumberTarget = Reflect.construct(F, [], NumberPrototype);
console.log("number prototype as new.target:", Object.getPrototypeOf(fromNumberTarget) === Object.prototype, fromNumberTarget.x, fromNumberTarget.target === NumberPrototype);

const prototypeFromTrap = { fromTrap: true };
const trappedTarget = new Proxy(function () {}, {
  get(callee, key) {
    return key === "prototype" ? prototypeFromTrap : callee[key];
  },
});
const fromTrap = Reflect.construct(F, [], trappedTarget);
console.log("prototype from trap:", fromTrap.fromTrap, fromTrap.x, fromTrap.target === trappedTarget);

class Base {
  constructor() {
    this.target = new.target;
  }
}
class Derived extends Base {}
console.log("class new.target:", new Derived().target === Derived, new Base().target === Base);
const other = Reflect.construct(Base, [], F);
console.log("class with other new.target:", other instanceof F, other instanceof Base, other.target === F);

const plain = new F();
console.log("plain new:", plain.x, plain.target === F, Object.getPrototypeOf(plain) === F.prototype);
