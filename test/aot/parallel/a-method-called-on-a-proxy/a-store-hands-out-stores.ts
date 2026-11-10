// As a reactive store does: a Proxy hands out Proxies of the plain objects below it, and a function with a declared parameter calls a method two levels down.
type Lookup = {
  get(name: string): readonly { key: string }[] | undefined;
  size(): number;
};
type Config = { keybinds: Lookup; leader: { timeout: number } };
const wrapped = new WeakMap<object, object>();
let reads = 0;
const traps: ProxyHandler<any> = {
  get(target, name, receiver) {
    reads++;
    const value = Reflect.get(target, name, receiver);
    return value !== null &&
      typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype
      ? wrap(value)
      : value;
  },
};
function wrap<T extends object>(value: T): T {
  let proxy = wrapped.get(value);
  if (!proxy) wrapped.set(value, (proxy = new Proxy(value, traps)));
  return proxy as T;
}
const table = new Map([["leader", [{ key: "space" }]]]);
const config: Config = wrap({
  keybinds: { get: (name: string) => table.get(name), size: () => table.size },
  leader: { timeout: 2000 },
});
function formatOptions(config: Config) {
  const leader = config.keybinds.get("leader")?.[0]?.key;
  const other = config.keybinds.get("other")?.[0]?.key;
  return {
    leader: leader ?? "none",
    other: other ?? "none",
    size: config.keybinds.size(),
    timeout: config.leader.timeout,
  };
}
let last = "";
for (let i = 0; i < 300; i++) last = JSON.stringify(formatOptions(config));
console.log(last, reads);
