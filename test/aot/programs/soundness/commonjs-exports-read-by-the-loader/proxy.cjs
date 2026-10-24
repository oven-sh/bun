globalThis.trapLog = [];
module.exports = new Proxy({ a: 1 }, {
  ownKeys(target) { globalThis.trapLog.push("ownKeys"); return Reflect.ownKeys(target); },
  getOwnPropertyDescriptor(target, key) { globalThis.trapLog.push("descriptor"); return Reflect.getOwnPropertyDescriptor(target, key); },
  get(target, key) { globalThis.trapLog.push("get"); return target[key]; },
});
