// literal control.
function use(p) { return Object.getPrototypeOf(p) === Object.prototype; }
let record = { x: 1, y: 2 };
record = { x: 1, y: 2, ["__proto__"]: { z: "inherited" } };
console.log(use(record));
