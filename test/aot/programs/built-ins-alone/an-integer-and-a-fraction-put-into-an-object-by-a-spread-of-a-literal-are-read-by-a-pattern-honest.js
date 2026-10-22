const held = { ...{ a: 7 }, b: 1.5 };
const { a, b, c } = held;
console.log(a + 1, b + 1);
console.log(c === undefined);
