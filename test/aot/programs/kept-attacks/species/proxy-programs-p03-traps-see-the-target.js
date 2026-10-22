// Species: proxy programs  traps see the target. It prints what plain Bun prints.
const log = [];
class Body { constructor() { this.hits = 1; } }
const b = new Body();
const p = new Proxy(b, {
  get(target, key, receiver) { log.push("get " + String(key) + " " + (target === b) + " " + (receiver === p)); return target[key]; },
  set(target, key, value) { log.push("set " + String(key) + " " + typeof value); target[key] = value; return true; },
  has(target, key) { log.push("has " + String(key)); return key in target; },
  deleteProperty(target, key) { log.push("delete " + String(key)); return delete target[key]; },
  ownKeys(target) { log.push("ownKeys"); return Reflect.ownKeys(target); },
  getOwnPropertyDescriptor(target, key) { log.push("descriptor " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); },
  defineProperty(target, key, descriptor) { log.push("define " + String(key)); return Reflect.defineProperty(target, key, descriptor); },
  getPrototypeOf(target) { log.push("getPrototypeOf"); return Reflect.getPrototypeOf(target); },
  setPrototypeOf(target, proto) { log.push("setPrototypeOf"); return Reflect.setPrototypeOf(target, proto); },
  isExtensible(target) { log.push("isExtensible"); return Reflect.isExtensible(target); },
  preventExtensions(target) { log.push("preventExtensions"); return Reflect.preventExtensions(target); },
});
p.hits; p.hits = "s"; "hits" in p; Object.keys(p); p instanceof Body; Object.defineProperty(p, "x", { value: 1, configurable: true }); delete p.x;
Object.setPrototypeOf(p, Body.prototype); Object.isExtensible(p); Object.preventExtensions(p);
console.log(log.join("\n")); console.log(typeof b.hits);
