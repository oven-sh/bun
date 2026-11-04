// literal control.
function use(p) { return typeof p.toString; }
let record = { x: 1, y: 2 };
record = { x: 1, y: 2, ["__proto__"]: { z: "inherited" } };
console.log(use(record));
