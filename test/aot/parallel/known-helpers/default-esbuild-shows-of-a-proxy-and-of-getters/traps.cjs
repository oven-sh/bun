const seen = [];
globalThis.seenTraps = seen;
module.exports = new Proxy({ a: 1 }, {
  get(target, key, receiver) { seen.push("get " + String(key)); return Reflect.get(target, key, receiver); },
  getPrototypeOf(target) { seen.push("getPrototypeOf"); return Reflect.getPrototypeOf(target); },
  ownKeys(target) { seen.push("ownKeys"); return Reflect.ownKeys(target); },
  getOwnPropertyDescriptor(target, key) { seen.push("getOwnPropertyDescriptor " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); },
  has(target, key) { seen.push("has " + String(key)); return Reflect.has(target, key); },
});
