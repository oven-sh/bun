const close = Object.freeze, above = Object.getPrototypeOf({});
close(above);
const E = {};
E.toString = 0;
console.log(typeof E.toString, Object.keys(E).length);
