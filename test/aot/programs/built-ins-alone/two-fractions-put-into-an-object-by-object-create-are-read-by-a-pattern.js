const held = Object.create(null, { a: { value: 1.5, enumerable: true }, b: { value: 2.5, enumerable: true } });
const { a, b, c } = held;
console.log(a + 1, b + 1);
console.log(c === undefined);
