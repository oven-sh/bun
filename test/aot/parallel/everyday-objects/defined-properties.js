// Properties that are defined: hidden, fixed, and accessors by descriptor
function make(n) {
  const object = { plain: n };
  Object.defineProperty(object, "hidden", { value: n + 1, writable: true });
  Object.defineProperty(object, "fixed", { value: n + 2, enumerable: true });
  Object.defineProperty(object, "double", { get() { return this.plain * 2; }, enumerable: true, configurable: true });
  object.hidden += 10;
  object.plain++;
  const keys = [];
  for (const key in object) keys.push(key);
  return keys.join() + " " + object.hidden + " " + object.double + " " + JSON.stringify(object) + Object.getOwnPropertyNames(object).length + JSON.stringify(Object.getOwnPropertyDescriptor(object, "fixed"));
}
console.log(make(1));
console.log(make(20));
console.log(make(-3));
