// `sort` of numbers: the result is right although the comparator defines a read-only indexed property on a prototype.
const p = {}; Object.create(p);
console.log([3, 2, 1].sort((x, y) => (Object.defineProperty(p, 0, { value: 7, writable: false }), x - y)).join());
