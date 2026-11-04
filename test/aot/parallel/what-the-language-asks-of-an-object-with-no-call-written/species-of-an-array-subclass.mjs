let hits = 0;
class A extends Array { static get [Symbol.species]() { hits++; return Array; } }
const a = new A(1, 2, 3);
const b = a.map(v => v * 2);
console.log(hits, b instanceof A, b.join());
