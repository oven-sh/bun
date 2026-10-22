const held = Object.create(null, { a: { value: 7, enumerable: true }, b: { value: 1.5, enumerable: true } });
const copy = Object.assign({}, held);
console.log(copy.a + 1, copy.b + 1);
