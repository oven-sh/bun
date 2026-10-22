const held = Object.assign({}, { a: "text" }, { b: "more text" });
const copy = structuredClone(held);
console.log(copy.a.length, copy.b.length);
