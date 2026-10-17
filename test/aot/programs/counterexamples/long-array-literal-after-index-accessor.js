// An array literal of more than 32 elements, evaluated after an indexed accessor was defined on a prototype.
const p = {}; Object.create(p);
Object.defineProperty(p, 0, { get() {} });
console.log([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, {}].length);
