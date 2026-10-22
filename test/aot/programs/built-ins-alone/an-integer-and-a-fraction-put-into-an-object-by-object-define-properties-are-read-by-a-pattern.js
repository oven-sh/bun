const held = Object.defineProperties({}, { a: { value: 7, enumerable: true }, b: { value: 1.5, enumerable: true } });
const { a, b, c } = held;
console.log(a + 1, b + 1);
console.log(c === undefined);
