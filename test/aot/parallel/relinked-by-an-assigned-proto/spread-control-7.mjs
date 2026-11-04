// spread control.
function use(p) { return Object.hasOwn(p, "__proto__"); }
let record = { x: 1, y: 2 };
record = { ...record, ...{ ["__proto__"]: { z: "inherited" } } };
console.log(use(record));
