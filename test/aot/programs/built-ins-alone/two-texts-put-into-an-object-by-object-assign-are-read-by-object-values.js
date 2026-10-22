const held = Object.assign({}, { a: "text" }, { b: "more text" });
const list = Object.values(held);
console.log(list.length);
console.log(list[0].length, list[1].length);
