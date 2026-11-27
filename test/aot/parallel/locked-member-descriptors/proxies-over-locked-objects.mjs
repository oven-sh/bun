// No proxy throws over a locked object where it does not throw under plain Bun: forwarding traps, traps that answer otherwise, a stand-in target, and the global object. Nothing here prints whether a member is writable.
const attempt = f => {
  try {
    return JSON.stringify(f()) ?? "undefined";
  } catch (error) {
    return "throws " + error.name;
  }
};
const shape = d => d && { kind: "value" in d ? "data" : "accessor", enumerable: d.enumerable, configurable: d.configurable };
const everyTrap = Object.fromEntries(Object.getOwnPropertyNames(Reflect).filter(name => typeof Reflect[name] === "function").map(name => [name, Reflect[name]]));
const members = [
  ["Array.prototype", Array.prototype, "push"],
  ["Array.prototype", Array.prototype, "length"],
  ["Array.prototype", Array.prototype, Symbol.iterator],
  ["Buffer", Buffer, "concat"],
  ["Object", Object, "keys"],
  ["Math", Math, "PI"],
  ["Map.prototype", Map.prototype, "size"],
  ["Object.prototype", Object.prototype, "__proto__"],
  ["Function.prototype", Function.prototype, "call"],
  ["Blob.prototype", Blob.prototype, "arrayBuffer"],
  ["globalThis", globalThis, "Array"],
  ["globalThis", globalThis, "process"],
  ["globalThis", globalThis, "globalThis"],
];
for (const [name, target, key] of members) {
  const forwarding = new Proxy(target, { getOwnPropertyDescriptor: (t, k) => Reflect.getOwnPropertyDescriptor(t, k) });
  const all = new Proxy(target, everyTrap);
  const saysYes = new Proxy(target, { defineProperty: () => true });
  const standIn = new Proxy(typeof target === "function" ? function () {} : {}, { getOwnPropertyDescriptor: (t, k) => Reflect.getOwnPropertyDescriptor(target, k) });
  console.log(
    name, String(key),
    "| no trap", attempt(() => shape(Object.getOwnPropertyDescriptor(new Proxy(target, {}), key))),
    "| forwarding", attempt(() => shape(Object.getOwnPropertyDescriptor(forwarding, key))), attempt(() => shape(Reflect.getOwnPropertyDescriptor(new Proxy(forwarding, {}), key))), attempt(() => Object.hasOwn(forwarding, key)),
    "| every trap", attempt(() => shape(Object.getOwnPropertyDescriptor(all, key))), attempt(() => Object.defineProperty(all, key, Object.getOwnPropertyDescriptor(all, key)) === all), attempt(() => Reflect.defineProperty(all, key, Reflect.getOwnPropertyDescriptor(target, key))),
    "| a trap that says yes", attempt(() => Reflect.defineProperty(saysYes, key, Object.getOwnPropertyDescriptor(saysYes, key))),
    "| a stand-in", attempt(() => shape(Object.getOwnPropertyDescriptor(standIn, key))),
  );
}
for (const [name, target] of [["globalThis", globalThis], ["Array.prototype", Array.prototype], ["Buffer", Buffer], ["Blob.prototype", Blob.prototype]]) {
  const forwarding = new Proxy(target, { getOwnPropertyDescriptor: (t, k) => Reflect.getOwnPropertyDescriptor(t, k) });
  console.log(name, "keys", attempt(() => Object.keys(forwarding).length === Object.keys(target).length), "all descriptors", attempt(() => Reflect.ownKeys(Object.getOwnPropertyDescriptors(forwarding)).length === Reflect.ownKeys(target).length), "spread", attempt(() => Object.keys({ ...forwarding }).length === Object.keys(target).length));
}
const mine = () => "mine";
const answering = new Proxy(Buffer, {
  get: (target, key, receiver) => (key === "concat" ? mine : Reflect.get(target, key, receiver)),
  has: (target, key) => key !== "concat" && Reflect.has(target, key),
  ownKeys: target => Reflect.ownKeys(target).filter(key => key !== "concat"),
  getOwnPropertyDescriptor: (target, key) => (key === "concat" ? undefined : Reflect.getOwnPropertyDescriptor(target, key)),
  deleteProperty: () => true,
});
console.log("a trap answers otherwise", attempt(() => answering.concat()), attempt(() => "concat" in answering), attempt(() => Reflect.ownKeys(answering).includes("concat")), attempt(() => Object.getOwnPropertyDescriptor(answering, "concat") === undefined), attempt(() => delete answering.concat));
