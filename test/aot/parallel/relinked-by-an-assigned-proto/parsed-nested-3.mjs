// parsed nested.
function use(p) { return Object.getPrototypeOf(p) === Object.prototype; }
let record = { x: 1, y: 2 };
Object.assign(record, JSON.parse('{"a": {"__proto__": {"z": "inherited"}}}').a);
console.log(use(record));
