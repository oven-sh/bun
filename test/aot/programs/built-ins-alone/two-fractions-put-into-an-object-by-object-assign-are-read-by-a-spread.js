const held = Object.assign({}, { a: 1.5 }, { b: 2.5 });
const copy = { ...held };
console.log(copy.a + 1, copy.b + 1);
