// In the manner of core-js 2 and of 3.0 to 3.6: a helper redefines a member by deleting it and defining it again. The first member it redefines is Function.prototype.toString, so that a function it installs prints the text of the one it stands for.
const texts = new WeakMap();
const nativeToString = Function.prototype.toString;

function hide(object, key, value) {
  Object.defineProperty(object, key, { value, enumerable: false, writable: true, configurable: true });
}
function redefine(object, key, value) {
  if (typeof value === "function" && typeof object[key] === "function") texts.set(value, nativeToString.call(object[key]));
  delete object[key];
  hide(object, key, value);
}

redefine(Function.prototype, "toString", function toString() {
  return (typeof this === "function" && texts.get(this)) || nativeToString.call(this);
});

const holder = { parse: JSON.parse };
redefine(holder, "parse", function parse(text) { return JSON.parse(text); });

const descriptor = Object.getOwnPropertyDescriptor(Function.prototype, "toString");
console.log([typeof descriptor.value, descriptor.value === nativeToString, descriptor.enumerable, descriptor.writable, descriptor.configurable].join(" "));
console.log([String(holder.parse) === nativeToString.call(JSON.parse), String(Function.prototype.toString) === nativeToString.call(nativeToString), String(Math.max) === nativeToString.call(Math.max), `${Math.max}`.includes("[native code]"), holder.parse("[1]").length].join(" "));
console.log(Object.keys(Function.prototype).length, Object.isExtensible(Function.prototype), Object.getOwnPropertyNames(Function.prototype).includes("toString"));
