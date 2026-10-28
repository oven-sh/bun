// `sort` of more than eight numbers whose comparator defines a read-only indexed property on a prototype.
const p = Object.create(null); Object.create(p);
const cmp = (x, y) => (Object.defineProperty(p, 0, { value: 7, writable: false }), x - y);
console.log([9, 8, 7, 6, 5, 4, 3, 2, 1].sort(cmp).join());
