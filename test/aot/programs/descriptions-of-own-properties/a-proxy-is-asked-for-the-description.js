// The trap of a proxy is the one code of the program that a description runs.
const asked = [];
const target = {
  get computed() {
    asked.push("the getter of the target runs");
    return 1;
  },
  plain: 2,
};
const proxy = new Proxy(target, {
  getOwnPropertyDescriptor(object, key) {
    asked.push("asked for " + String(key));
    return Reflect.getOwnPropertyDescriptor(object, key);
  },
});
for (const key of globalThis.neverSet ? [] : ["computed", "plain", "missing"]) {
  const descriptor = Object.getOwnPropertyDescriptor(proxy, key);
  console.log(key, descriptor && typeof descriptor.get, descriptor && descriptor.value);
}
console.log(Reflect.getOwnPropertyDescriptor(proxy, "plain").value, Object.keys(proxy).join());
console.log(JSON.stringify(asked));
