// Untyped programs: g lookup getter. It prints what plain Bun prints.
const getter = (Map.prototype as any).__lookupGetter__("size");
console.log(typeof getter, typeof Object.getOwnPropertyDescriptor(Set.prototype, "size")?.get);
