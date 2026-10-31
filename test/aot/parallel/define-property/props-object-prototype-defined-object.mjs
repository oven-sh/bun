// The own properties of object prototype are defined on an object without a prototype.
const P = Object.defineProperties(Object.create(null), Object.getOwnPropertyDescriptors(Object.prototype));
console.log(typeof P.hasOwnProperty);
