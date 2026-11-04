Object.defineProperties(Object.prototype, { toString: { writable: false }, constructor: { writable: false } });
const E = {};
E.toString = 0; E.constructor = 1;
console.log(typeof E.toString, typeof E.constructor, Object.keys(E).length);
