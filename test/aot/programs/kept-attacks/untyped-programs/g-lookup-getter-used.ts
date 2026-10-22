// Untyped programs: g lookup getter used. It prints what plain Bun prints.
const getter = (Map.prototype as any).__lookupGetter__("size");
console.log(typeof getter, new Map([[1, 2]]).size);
