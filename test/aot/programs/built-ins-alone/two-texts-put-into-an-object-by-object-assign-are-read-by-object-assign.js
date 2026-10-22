const held = Object.assign({}, { a: "text" }, { b: "more text" });
const copy = Object.assign({}, held);
console.log(copy.a.length, copy.b.length);
