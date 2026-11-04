// parsed nested.
function use(p) { return typeof p.x; }
let record = { x: 1, y: 2 };
Object.assign(record, JSON.parse('{"a": {"__proto__": {"z": "inherited"}}}').a);
console.log(use(record));
