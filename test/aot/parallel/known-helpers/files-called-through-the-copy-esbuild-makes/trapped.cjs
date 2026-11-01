globalThis.traps = [];
module.exports = new Proxy(
  { who() { return this; }, count: 3 },
  {
    get(target, key, receiver) {
      globalThis.traps.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
    has(target, key) {
      globalThis.traps.push("has " + String(key));
      return Reflect.has(target, key);
    },
    ownKeys(target) {
      globalThis.traps.push("ownKeys");
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key) {
      globalThis.traps.push("getOwnPropertyDescriptor " + String(key));
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    getPrototypeOf(target) {
      globalThis.traps.push("getPrototypeOf");
      return Reflect.getPrototypeOf(target);
    },
  },
);
