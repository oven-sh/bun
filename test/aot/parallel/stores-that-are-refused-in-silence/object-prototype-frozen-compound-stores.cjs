Object.freeze(Object.prototype);
const E = {};
E.valueOf &&= 1; E.toString += "!"; E.constructor ??= 2; E.hasOwnProperty ||= 3;
console.log(typeof E.valueOf, typeof E.toString, typeof E.constructor, typeof E.hasOwnProperty, Object.keys(E).length);
