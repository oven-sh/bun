const held = Object.assign({}, { a: 7 }, { b: "text" });
const copy = Object.assign({}, held);
console.log(copy.a + 1, copy.b.length);
