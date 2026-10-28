// `Array.from` with a mapping function: the result is right although the function defines an indexed accessor on a prototype.
const p = {}; Object.create(p);
console.log(Array.from([1, 2, 3], x => (x === 3 && Object.defineProperty(p, 0, { get() {} }), x * 10)).join());
