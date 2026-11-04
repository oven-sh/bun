Object.freeze(Object.prototype);
const E = {};
const key = ["to", "String"].join("");
E[key] = 0;
console.log(typeof E.toString, typeof E[key], Object.keys(E).length);
