// literal that links.
function use(p) { return typeof p.x; }
let record = { x: 1, y: 2 };
record = { x: 1, y: 2, __proto__: { z: "inherited" } };
console.log(use(record));
