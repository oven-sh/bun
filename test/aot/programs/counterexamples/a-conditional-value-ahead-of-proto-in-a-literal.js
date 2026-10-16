// `{ a: s ? 1 : 2, __proto__: s }` has its own property a.
const s = {}, o = { a: s ? 1 : 2, __proto__: s };
for (const k in s) o[k] = 1;
console.log(o.a);
