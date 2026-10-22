const held = Object.assign({}, { a: "text" }, { b: "more text" });
const copy = { ...held };
console.log(copy.a.length, copy.b.length);
