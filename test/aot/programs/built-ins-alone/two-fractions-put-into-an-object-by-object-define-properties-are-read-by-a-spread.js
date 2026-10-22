const held = Object.defineProperties({}, { a: { value: 1.5, enumerable: true }, b: { value: 2.5, enumerable: true } });
const copy = { ...held };
console.log(copy.a + 1, copy.b + 1);
