// `filter`: the result is right although the callback defines an indexed accessor on an object that is a prototype.
const p = {}; Object.create(p);
console.log([1, 2, 3].filter(x => (x === 3 && Object.defineProperty(p, 0, { get() {} }), true)).join());
