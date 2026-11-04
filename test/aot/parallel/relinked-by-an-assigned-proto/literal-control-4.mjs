// literal control.
function use(p) { return Object.keys(p).join(); }
let record = { x: 1, y: 2 };
record = { x: 1, y: 2, ["__proto__"]: { z: "inherited" } };
console.log(use(record));
