const held = Object.assign({}, { a: 7 }, { b: "text" });
const map = new Map(Object.entries(held));
console.log(map.get("a") + 1, map.get("b").length);
