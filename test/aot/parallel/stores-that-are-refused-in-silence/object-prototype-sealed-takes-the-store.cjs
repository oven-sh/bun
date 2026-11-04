Object.seal(Object.prototype);
const E = {};
E.toString = 0;
console.log(typeof E.toString, Object.keys(E).length);
