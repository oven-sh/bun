const held = Object.assign({}, { a: "text" }, { b: "more text" });
const map = new Map(Object.entries(held));
console.log(map.get("a").length, map.get("b").length);
