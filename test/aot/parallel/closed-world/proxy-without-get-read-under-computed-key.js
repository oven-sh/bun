// A proxy whose handler has a trap for stores alone is read under a key that is computed. The read goes on at the target and may come to the accessor `__proto__` of Object.prototype,
// which asks the proxy what stands above it: the handler has no trap for that either, so the target answers. Nothing else is done to the proxy, and nothing of the library is compiled for it.
// STATISTIC: ImageFunctionsEmitted <= 20
const key = JSON.parse('"count"');
const stored = [];
const proxy = new Proxy({ count: 0 }, {
  set(target, name, value) { stored.push(name + "=" + String(value)); return Reflect.defineProperty(target, name, { value: String(value), writable: true, enumerable: true, configurable: true }); },
});
proxy.count = 1;
console.log(typeof proxy[key] + " " + proxy[key], stored.join());
console.log(proxy[JSON.parse('"__proto__"')] === Object.prototype, Object.getPrototypeOf(proxy) === Object.prototype, Reflect.getPrototypeOf(proxy) === Object.prototype);
