// Impostors narrowing and accessors: wg probes nat  join. It prints what plain Bun prints.
const log: string[] = [];
const proxy = new Proxy([10, 20, 30], {
  get(t, key, receiver) {
    log.push("get " + String(key));
    return Reflect.get(t, key, receiver);
  },
});
console.log(proxy.join(), log.join());
