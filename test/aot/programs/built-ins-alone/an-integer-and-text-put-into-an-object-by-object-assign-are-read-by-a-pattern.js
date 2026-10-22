const held = Object.assign({}, { a: 7 }, { b: "text" });
const { a, b, c } = held;
console.log(a + 1, b.length);
console.log(c === undefined);
