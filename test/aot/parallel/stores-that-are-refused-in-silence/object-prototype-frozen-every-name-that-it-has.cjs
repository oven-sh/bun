Object.freeze(Object.prototype);
const E = {};
E.valueOf = 1; E.constructor = 2; E.hasOwnProperty = 3; E.toLocaleString = 4; E.isPrototypeOf = 5; E.propertyIsEnumerable = 6; E.other = 7;
console.log(typeof E.valueOf, typeof E.constructor, typeof E.hasOwnProperty, typeof E.toLocaleString, typeof E.isPrototypeOf, typeof E.propertyIsEnumerable, typeof E.other, Object.keys(E).join());
