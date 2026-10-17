// `o.d = 5; o.d = 6` on a literal with a repeated key: the second store counts.
const o = { a: 1, a: 2, b: 3 };
o.d = 5;
o.d = 6;
console.log(Object.assign(o, {}).d);
