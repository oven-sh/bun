// literal that links.
function use(p) { return p.x + 1; }
let record = { x: 1, y: 2 };
record = { x: 1, y: 2, __proto__: { z: "inherited" } };
console.log(use(record));
