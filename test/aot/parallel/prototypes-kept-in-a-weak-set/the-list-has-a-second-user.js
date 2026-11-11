const list = [Object.prototype, Error.prototype];
const kept = new WeakSet(list);
console.log(kept.has(list[1]), list[JSON.parse("1")].toString());
