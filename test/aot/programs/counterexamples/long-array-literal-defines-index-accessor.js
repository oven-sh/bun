// An array literal of more than 32 elements, one of which defines an indexed accessor on a prototype while it is evaluated.
const p = {}; Object.create(p);
const bad = () => (Object.defineProperty(p, 0, { get() {} }), "b");
console.log(["a", bad(), 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32].join());
