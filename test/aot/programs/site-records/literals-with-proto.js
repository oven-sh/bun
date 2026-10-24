// `__proto__: value` in an object literal sets the prototype. A shorthand, a computed key, a method, an accessor and a spread of that name make an ordinary property. Fields are read from such objects and from what hangs below them.
const base = {
  inherited: "from base",
  shared: "base's",
  hello() {
    return "hello from " + this.own;
  },
};

function show(value) {
  const prototype = Object.getPrototypeOf(value);
  const above = prototype === base ? "base" : prototype === Object.prototype ? "Object.prototype" : prototype === null ? "null" : prototype === Array.prototype ? "Array.prototype" : "another";
  return "[" + Reflect.ownKeys(value).map(String).join() + "] below " + above + ", own=" + String(ownOf(value)) + ", inherited=" + String(inheritedOf(value)) + ", shared=" + String(sharedOf(value));
}
function attempt(run) {
  try {
    return String(run());
  } catch (error) {
    return "throws " + error.constructor.name;
  }
}
function ownOf(value) {
  return value.own;
}
function inheritedOf(value) {
  return value.inherited;
}
function sharedOf(value) {
  return value.shared;
}
function hello(value) {
  return value.hello();
}

function protoFirst(prototype) {
  return { __proto__: prototype, own: 1, shared: "own" };
}
function protoLast(prototype) {
  return { own: 2, shared: "own", __proto__: prototype };
}
function protoBetween(prototype) {
  return { own: 3, __proto__: prototype, shared: "own" };
}
function protoQuoted(prototype) {
  return { own: 4, "__proto__": prototype };
}
function protoAlone(prototype) {
  return { __proto__: prototype };
}
function protoComputed(prototype) {
  return { own: 5, ["__proto__"]: prototype };
}
function protoComputedLater(prototype, key) {
  return { own: 6, [key]: prototype };
}
function protoShorthand(__proto__) {
  return { own: 7, __proto__ };
}
function protoMethod() {
  return {
    own: 8,
    __proto__() {
      return "a method";
    },
  };
}
function protoAccessor() {
  return {
    own: 9,
    get __proto__() {
      return "a getter";
    },
  };
}
function protoSpread(prototype) {
  return { own: 10, ...{ __proto__: prototype, spreadOwn: true } };
}
function protoSpreadOfOwn(source) {
  return { own: 11, ...source };
}
function protoAndComputed(prototype) {
  return { __proto__: prototype, own: 12, ["__proto__"]: "own property" };
}

const prototypes = [["base", base], ["null", null], ["undefined", undefined], ["number", 5], ["text", "text"], ["array prototype", Array.prototype], ["literal", { inherited: "from a literal" }], ["function", function () {}]];
for (const [name, prototype] of prototypes) {
  console.log(name + ":");
  console.log("  first:", show(protoFirst(prototype)));
  console.log("  last:", show(protoLast(prototype)));
  console.log("  between:", show(protoBetween(prototype)));
  console.log("  quoted:", show(protoQuoted(prototype)));
  console.log("  alone:", show(protoAlone(prototype)));
  console.log("  computed:", show(protoComputed(prototype)));
  console.log("  computed later:", show(protoComputedLater(prototype, ["__proto", "__"].join("__".slice(2)))));
  console.log("  shorthand:", show(protoShorthand(prototype)));
  console.log("  spread:", show(protoSpread(prototype)));
  console.log("  both:", show(protoAndComputed(prototype)));
}
console.log("method:", show(protoMethod()), typeof protoMethod().__proto__);
console.log("accessor:", show(protoAccessor()), protoAccessor().__proto__);
console.log("spread of an own one:", show(protoSpreadOfOwn(JSON.parse('{"__proto__":{"inherited":"parsed"},"shared":"parsed"}'))));
console.log("hello:", attempt(() => hello(protoFirst(base))), attempt(() => hello(protoLast(base))), attempt(() => hello(protoFirst(null))), attempt(() => hello(protoComputed(base))));

base.inherited = "changed on base";
delete base.shared;
console.log("after a change of base:", show(protoFirst(base)), "/", show(protoAlone(base)));
const below = protoAlone(protoAlone(protoFirst(base)));
console.log("three levels:", show(below), attempt(() => hello(below)));
below.__proto__ = null;
console.log("cut off:", show(below), Object.keys(below).join());
below.__proto__ = base;
console.log("an ordinary property now:", show(below), Object.keys(below).join());

export {};
