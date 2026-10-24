// Object.getOwnPropertyDescriptor and Reflect.getOwnPropertyDescriptor describe a property and call nothing. What they hand out under `get` and `set` runs when the program calls it.
const log = [];
const holder = {
  get first() {
    log.push("first runs");
    return 1;
  },
  get second() {
    log.push("second runs");
    return 2;
  },
  set second(value) {
    log.push("second is set to " + value);
  },
  plain: 3,
};
const keys = globalThis.neverSet ? ["none"] : Object.keys(holder);
const descriptors = [];
for (const key of keys) {
  descriptors.push(Object.getOwnPropertyDescriptor(holder, key));
  descriptors.push(Reflect.getOwnPropertyDescriptor(holder, key));
}
console.log("after describing:", JSON.stringify(log));
for (const descriptor of descriptors) {
  console.log(typeof descriptor.get, typeof descriptor.set, descriptor.value, descriptor.enumerable, descriptor.configurable, descriptor.writable);
  if (descriptor.get) console.log(descriptor.get.call(holder));
  if (descriptor.set) descriptor.set.call(holder, 7);
}
console.log(JSON.stringify(log));
