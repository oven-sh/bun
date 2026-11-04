Object.freeze(Object.prototype);
const E = {};
const taken = Reflect.set(E, "toString", 0);
console.log(taken, typeof E.toString, Object.keys(E).length);
