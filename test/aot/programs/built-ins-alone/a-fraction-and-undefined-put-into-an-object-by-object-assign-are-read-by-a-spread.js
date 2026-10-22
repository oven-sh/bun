const held = Object.assign({}, { a: 1.5 }, { b: undefined });
const copy = { ...held };
console.log(copy.a + 1, copy.b === undefined);
