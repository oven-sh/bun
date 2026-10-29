// A polyfill that defines what is there, and whoever writes out what Object.freeze() does: the build says nothing, and the definitions pass.
Object.defineProperty(Array.prototype, "includes", { value: Array.prototype.includes, writable: true, configurable: true, enumerable: false });
Object.defineProperty(Array.prototype, "indexOf", { value: Array.prototype.indexOf });
Object.defineProperty(Array.prototype, "join", Object.getOwnPropertyDescriptor(Array.prototype, "join"));
Object.defineProperty(Array.prototype, "keys", { writable: false });
Object.defineProperties(Math, { max: { writable: false } });
console.log(Reflect.defineProperty(Math, "min", { configurable: false }), Reflect.defineProperty(Math, "min", { configurable: true }));
for (const [object, key] of [[Array.prototype, "includes"], [Array.prototype, "indexOf"], [Array.prototype, "join"], [Array.prototype, "keys"], [Math, "max"], [Math, "min"]]) {
  const { writable, configurable, enumerable } = Object.getOwnPropertyDescriptor(object, key);
  console.log(key, writable, configurable, enumerable);
}
console.log([1, 2].includes(2), [1, 2].indexOf(2), [1, 2].join("+"), [...[1, 2].keys()].join(), Math.max(1, 2), Math.min(1, 2));
