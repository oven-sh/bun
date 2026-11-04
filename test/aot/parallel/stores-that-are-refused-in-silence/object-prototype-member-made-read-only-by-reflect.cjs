Reflect.defineProperty(Object.prototype, "valueOf", { writable: false });
const E = {};
E.valueOf = 1;
console.log(typeof E.valueOf, Object.keys(E).length);
