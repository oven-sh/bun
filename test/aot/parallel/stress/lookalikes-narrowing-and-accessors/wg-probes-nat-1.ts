// Impostors narrowing and accessors: wg probes nat. It prints what plain Bun prints.
const log: string[] = [];
const proxy = new Proxy([10, 20, 30], {
  get(t, key, receiver) {
    log.push("get " + String(key));
    return Reflect.get(t, key, receiver);
  },
  set(t, key, value, receiver) {
    return Reflect.set(t, key, value, receiver);
  },
});
proxy.push(40);
console.log(log.join());
