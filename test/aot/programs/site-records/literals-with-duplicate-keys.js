// Object literals that name a key more than once: values, accessors and methods replace each other, the key keeps its first place, and every value is still evaluated.
const trail = [];

function noted(value) {
  trail.push(String(value));
  return value;
}
function show(value) {
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + "=" + ("value" in property ? (typeof property.value === "function" ? "function" : String(property.value)) : (property.get ? "get" : "") + (property.set ? "set" : "")) + (property.enumerable ? "" : "!"));
  }
  return parts.join(" ") + " | " + trail.splice(0).join();
}

function valueTwice() {
  return { a: noted(1), b: noted(2), a: noted(3) };
}
function valueThrice() {
  return { a: noted(1), a: noted("two"), b: noted(2), a: noted(null) };
}
function otherSpellings() {
  return { a: noted(1), "a": noted(2), ["a"]: noted(3), 1: noted(4), "1": noted(5), 1.0: noted(6), 0x1: noted(7) };
}
function valueThenGetter() {
  return {
    a: noted(1),
    b: 2,
    get a() {
      return 3;
    },
  };
}
function getterThenValue() {
  return {
    get a() {
      return 3;
    },
    b: 2,
    a: noted(1),
  };
}
function getterThenSetter() {
  return {
    get a() {
      return 1;
    },
    b: 2,
    set a(value) {},
  };
}
function getterValueSetter() {
  return {
    get a() {
      return 1;
    },
    a: noted(2),
    set a(value) {},
  };
}
function twoGetters() {
  return {
    get a() {
      return "first";
    },
    get a() {
      return "second";
    },
  };
}
function methodThenValue() {
  return {
    a() {},
    b: 2,
    a: noted(1),
  };
}
function valueThenMethod() {
  return {
    a: noted(1),
    b: 2,
    a() {},
  };
}
function shorthandAndValue(a) {
  return { a, b: 2, a: noted(1), a };
}
function spreadBetween(source) {
  return { a: noted(1), ...source, a: noted(2), b: noted(3) };
}
function computedOverNamed(key) {
  return { a: noted(1), b: noted(2), [key]: noted(3), a: noted(4) };
}

console.log("value twice:", show(valueTwice()));
console.log("value thrice:", show(valueThrice()));
console.log("other spellings:", show(otherSpellings()));
console.log("value then getter:", show(valueThenGetter()), valueThenGetter().a);
console.log("getter then value:", show(getterThenValue()), getterThenValue().a);
console.log("getter then setter:", show(getterThenSetter()), getterThenSetter().a);
console.log("getter, value, setter:", show(getterValueSetter()), getterValueSetter().a);
console.log("two getters:", show(twoGetters()), twoGetters().a);
console.log("method then value:", show(methodThenValue()));
console.log("value then method:", show(valueThenMethod()));
console.log("shorthand and value:", show(shorthandAndValue("short")));
console.log("spread between:", show(spreadBetween({ b: "spread b", a: "spread a", c: "spread c" })));
console.log("spread between, empty:", show(spreadBetween({})));
console.log("computed over named:", show(computedOverNamed("a")), "/", show(computedOverNamed("b")), "/", show(computedOverNamed("c")));
console.log("again:", show(valueTwice()), "/", show(valueThenGetter()), "/", show(getterThenValue()));

export {};
