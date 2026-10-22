const held = Object.assign({}, { a: "text" }, { b: "more text" });
const { a, b, c } = held;
console.log(a.length, b.length);
console.log(c === undefined);
