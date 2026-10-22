const held = Object.assign({}, { a: 1.5 }, { b: undefined });
const { a, b, c } = held;
console.log(a + 1, b === undefined);
console.log(c === undefined);
