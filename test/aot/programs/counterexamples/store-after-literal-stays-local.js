// A second store to a property added after a literal does not overwrite the object allocated next.
const o = { a: 1, a: 2, b: 3 };
o.d = 5;
const n = { p: 1 };
o.d = 7;
Object.assign(o, {});
console.log(n.p);
