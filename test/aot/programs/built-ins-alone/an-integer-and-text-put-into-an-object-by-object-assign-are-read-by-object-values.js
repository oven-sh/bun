const held = Object.assign({}, { a: 7 }, { b: "text" });
const list = Object.values(held);
console.log(list.length);
console.log(list[0] + 1, list[1].length);
