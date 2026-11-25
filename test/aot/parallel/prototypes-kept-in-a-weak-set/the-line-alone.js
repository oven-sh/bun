const kept = new WeakSet([Object.prototype, Error.prototype]);
console.log(kept.has({}));
