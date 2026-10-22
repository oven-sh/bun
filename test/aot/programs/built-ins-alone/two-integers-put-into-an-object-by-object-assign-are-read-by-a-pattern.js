const held = Object.assign({}, { a: 7 }, { b: 8 });
const { a, b, c } = held;
console.log(a + 1, b + 1);
console.log(c === undefined);
