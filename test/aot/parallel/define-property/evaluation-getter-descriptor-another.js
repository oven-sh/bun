// Each evaluation of `{ get() {} }` makes a new function. An accessor that cannot be configured takes no other getter or setter, so the second definition fails: Object.defineProperty throws, Reflect.defineProperty answers false.
function tell(run) {
  try {
    return String(run());
  } catch (error) {
    return "threw " + error.name;
  }
}

function defineGetter(object) {
  return tell(() => (Object.defineProperty(object, "a", { get() { return 1; } }), "defined"));
}
function defineSetter(object) {
  return tell(() => (Object.defineProperty(object, "b", { set(value) {} }), "defined"));
}
function reflectGetter(object) {
  return tell(() => Reflect.defineProperty(object, "c", { get() {} }));
}
function defineArrow(object) {
  return tell(() => (Object.defineProperty(object, "d", { get: () => 2 }), "defined"));
}
function defineMany(object) {
  return tell(() => (Object.defineProperties(object, { e: { get() { return 3; } }, f: { set(value) {} } }), "defined"));
}
function describe() {
  return { get() { return 4; }, enumerable: true };
}
function defineDescribed(object) {
  return tell(() => (Object.defineProperty(object, "g", describe()), "defined"));
}
function defineOldStyle(object) {
  Object.defineProperty(object, "h", { get() { return 5; }, configurable: false });
  return tell(() => (object.__defineGetter__("h", function () { return 5; }), "defined"));
}
const shared = { get() { return 6; } };
function defineShared(object) {
  return tell(() => (Object.defineProperty(object, "i", shared), "defined"));
}
function defineConfigurable(object) {
  return tell(() => (Object.defineProperty(object, "j", { get() { return 7; }, configurable: true }), "defined"));
}
function defineValue(object) {
  return tell(() => Reflect.defineProperty(object, "k", { value() {} }));
}

for (const target of [{}, function () {}, []]) {
  for (const define of [defineGetter, defineSetter, reflectGetter, defineArrow, defineMany, defineDescribed, defineShared, defineConfigurable, defineValue])
    console.log(define.name, define(target), define(target), define(target));
}
console.log(defineOldStyle.name, defineOldStyle({}));

const first = Object.getOwnPropertyDescriptor(Object.defineProperty({}, "a", describe()), "a").get;
const second = Object.getOwnPropertyDescriptor(Object.defineProperty({}, "a", describe()), "a").get;
console.log(first === second, first(), second());
