Object.defineProperty(Object.prototype, "toString", { writable: false });
const E = {};
E.toString = 0; E.valueOf = 1;
console.log(typeof E.toString, typeof E.valueOf, Object.keys(E).join());
