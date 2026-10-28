// The constructor of a typed array class is called by native code, by super() and by `new`, for a new target that is not that constructor: a class below it, a plain function, a bound function, a proxy.
// What is made has the elements of the class that was called and the prototype of the new target. The same arrays made by from(), of() and the methods that ask Symbol.species, and arrays that get another prototype later.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name + ": " + error.message);
  }
}
function describe(one, Below, Parent) {
  let sum = 0;
  for (let k = 0; k < one.length; k++) sum += Number(one[k]);
  return [
    one.length,
    sum,
    one instanceof Below,
    one instanceof Parent,
    one.constructor === Below,
    one.constructor === Parent,
    one.constructor.name,
    Object.getPrototypeOf(one) === Below.prototype,
    Object.getPrototypeOf(one) === Parent.prototype,
    typeof one.method === "function" ? one.method() : "no method",
    Object.prototype.toString.call(one),
    ArrayBuffer.isView(one),
  ].join(" ");
}
const big = value => BigInt(value);
const plain = value => value;
for (const [Parent, element] of [
  [Uint8Array, plain],
  [Int8Array, plain],
  [Uint8ClampedArray, plain],
  [Int16Array, plain],
  [Uint16Array, plain],
  [Int32Array, plain],
  [Uint32Array, plain],
  [Float32Array, plain],
  [Float64Array, plain],
  [BigInt64Array, big],
  [BigUint64Array, big],
]) {
  class Late extends Parent {
    method() {
      return "method of " + this.constructor.name;
    }
  }
  class WithConstructor extends Parent {
    constructor(length) {
      super(length);
      this[0] = element(5);
    }
    method() {
      return "method of " + this.constructor.name;
    }
  }
  function Plain() {}
  Plain.prototype = {
    method() {
      return "method of a plain prototype";
    },
  };
  function WithoutPrototype() {}
  WithoutPrototype.prototype = 7;
  const list = [element(1), element(2), element(3)];
  console.log(Parent.name);
  tell(" Reflect.construct, itself", () => describe(Reflect.construct(Parent, [2]), Parent, Parent));
  tell(" Reflect.construct, a class below", () => describe(Reflect.construct(Parent, [2], Late), Late, Parent));
  tell(" Reflect.construct, a class below, a list", () => describe(Reflect.construct(Parent, [list], Late), Late, Parent));
  tell(" Reflect.construct, a plain function", () => describe(Reflect.construct(Parent, [2], Plain), Plain, Parent));
  tell(" Reflect.construct, no object for a prototype", () => describe(Reflect.construct(Parent, [2], WithoutPrototype), WithoutPrototype, Parent));
  tell(" Reflect.construct, a bound class", () => describe(Reflect.construct(Parent, [2], Late.bind(null)), Late, Parent));
  tell(" Reflect.construct, a proxy", () => describe(Reflect.construct(Parent, [2], new Proxy(Late, {})), Late, Parent));
  tell(" Reflect.construct, another built-in class", () => describe(Reflect.construct(Parent, [2], Array), Array, Parent));
  tell(" Reflect.construct of the class below for the parent", () => describe(Reflect.construct(Late, [2], Parent), Late, Parent));
  tell(" new, a class below", () => describe(new Late(2), Late, Parent));
  tell(" new, super()", () => describe(new WithConstructor(2), WithConstructor, Parent));
  tell(" new, a bound parent", () => describe(new (Parent.bind(null, 2))(), Parent, Parent));
  tell(" from, itself", () => describe(Parent.from(list), Parent, Parent));
  tell(" from, a class below", () => describe(Late.from(list), Late, Parent));
  tell(" from, called on a class below", () => describe(Parent.from.call(Late, list), Late, Parent));
  tell(" of, a class below", () => describe(Late.of(element(4), element(5)), Late, Parent));
  tell(" of, called on a class below", () => describe(Parent.of.call(Late, element(4)), Late, Parent));
  tell(" map of a class below", () => describe(new Late(list).map(value => value), Late, Parent));
  tell(" slice of a class below", () => describe(new Late(list).slice(1), Late, Parent));
  tell(" subarray of a class below", () => describe(new Late(list).subarray(1), Late, Parent));
  tell(" another prototype later", () => describe(Object.setPrototypeOf(Parent.from(list), Late.prototype), Late, Parent));
  tell(" another prototype later, of", () => describe(Object.setPrototypeOf(Parent.of(element(9)), Plain.prototype), Plain, Parent));
  tell(" no prototype later", () => {
    const one = Object.setPrototypeOf(Parent.from(list), null);
    return [one.length, one.constructor, String(one[1]), Object.getPrototypeOf(one)].join(" ");
  });
}
