// A method of an object literal may be named as the constructor of a class is.
const o = { constructor() { return 1; } };
console.log(typeof o);
