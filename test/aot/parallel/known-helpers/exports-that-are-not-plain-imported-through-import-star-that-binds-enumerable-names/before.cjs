const log = globalThis.log;
{
  const k = require("./changes.cjs");
  let reads = 0;
  Object.defineProperty(k, "__esModule", { get() { log.push("marker"); return reads++ > 0; }, configurable: true });
  Object.defineProperty(k, "value", { get() { return this === k ? "for the exports" : "for another object"; }, enumerable: true, configurable: true });
}
{
  const k = require("./removes-itself.cjs");
  Object.defineProperty(k, "__esModule", {
    get() {
      log.push("marker");
      delete k.__esModule;
      Object.defineProperty(k, "value", { get() { return this === k ? "for the exports" : "for another object"; }, enumerable: true, configurable: true });
      k.__esModule = 1;
      return false;
    },
    configurable: true,
  });
}
{
  const k = require("./removes-names.cjs");
  Object.defineProperty(k, "__esModule", { get() { log.push("marker"); delete k.value; delete k.other; return false; }, configurable: true });
}
{
  const k = require("./changes-what-is-above.cjs");
  Object.defineProperty(k, "__esModule", { get() { log.push("marker"); Object.setPrototypeOf(k, { inherited: "set by the marker" }); return false; }, configurable: true });
}
{
  const k = require("./below-a-proxy.cjs");
  Object.setPrototypeOf(k, new Proxy({ inherited: "inherited" }, {
    get(target, key, receiver) { log.push("get " + String(key)); return Reflect.get(target, key, receiver); },
    has(target, key) { log.push("has " + String(key)); return Reflect.has(target, key); },
    ownKeys(target) { log.push("ownKeys"); return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { log.push("getOwnPropertyDescriptor " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); },
    getPrototypeOf(target) { log.push("getPrototypeOf"); return Reflect.getPrototypeOf(target); },
  }));
}
{
  const k = require("./marked-zero.cjs");
  k.__esModule = 0;
}
{
  const k = require("./marked-true.cjs");
  k.__esModule = true;
  k.default = "a default of its own";
}
{
  const k = require("./fixed.cjs");
  Object.defineProperty(k, "value", { value: "fixed", writable: false, configurable: false, enumerable: true });
}
{
  const k = require("./frozen.cjs");
  Object.freeze(k);
}
{
  const k = require("./accessor.cjs");
  Object.defineProperty(k, "value", { get() { log.push("value"); return this === k ? "for the exports" : "for another object"; }, enumerable: true, configurable: true });
}
{
  const k = require("./hidden.cjs");
  Object.defineProperty(k, "value", { value: "hidden", writable: true, configurable: true, enumerable: false });
}
{
  const k = require("./untouched.cjs");

}
