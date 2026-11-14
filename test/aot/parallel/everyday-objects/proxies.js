// A Proxy that counts reads, gives defaults and refuses some writes
function wrap(target, log) {
  return new Proxy(target, {
    get: (object, key, receiver) => (log.push("g" + String(key)), key in object ? Reflect.get(object, key, receiver) : 100),
    set(object, key, value) {
      if (value < 0) return true;
      log.push("s" + key);
      object[key] = value;
      return true;
    },
    has: (object, key) => key.startsWith("x") || key in object,
  });
}
function run(n) {
  const log = [];
  const proxy = wrap({ a: n, get sum() { return this.a + this.b; } }, log);
  proxy.b = n + 1;
  proxy.c = -1;
  return [proxy.sum, proxy.none, "xyz" in proxy, "c" in proxy, Object.keys(proxy).join("+"), log.join("")].join();
}
console.log(run(1));
console.log(run(10));
console.log(run(0));
