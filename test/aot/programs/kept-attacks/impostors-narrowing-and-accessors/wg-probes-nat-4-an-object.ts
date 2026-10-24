// Impostors narrowing and accessors: wg probes nat  an object. It prints what plain Bun prints.
const log: string[] = [];
const proxy = new Proxy({ a: 1 }, {
  get(t, key, receiver) {
    log.push("get " + String(key));
    return Reflect.get(t, key, receiver);
  },
});
console.log(proxy.a, log.join());
