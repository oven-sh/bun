// Untyped programs: g lookup by parameter. It prints what plain Bun prints.
function getGetter(cls: any, name: string | symbol) { return Function.prototype.call.bind(cls.prototype.__lookupGetter__(name)); }
const size = getGetter(Map, "size"), length = getGetter(Uint8Array, "length");
console.log(size(new Map([[1, 2]])), length(new Uint8Array(3)));
