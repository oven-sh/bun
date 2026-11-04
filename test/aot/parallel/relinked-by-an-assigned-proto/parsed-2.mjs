// parsed.
function use(p) { return String(p.z); }
let record = { x: 1, y: 2 };
Object.assign(record, JSON.parse('{"__proto__": {"z": "inherited", "x": "above"}}'));
console.log(use(record));
