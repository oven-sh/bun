const o = { g: Object.prototype.__lookupGetter__.call(new Event("y"), "isTrusted") };
console.log(typeof o.g);
