let n = 0;
const key = { toString() { return n++ ? "b" : "a"; } };
const target = { b: [1, 2] };
Object.defineProperty(target, key, Object.getOwnPropertyDescriptor({ a: { length: 3 }, b: [1, 2] }, key));
console.log(target.b.length);
