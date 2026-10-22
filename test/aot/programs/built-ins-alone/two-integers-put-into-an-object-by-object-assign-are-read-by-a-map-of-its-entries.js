const held = Object.assign({}, { a: 7 }, { b: 8 });
const map = new Map(Object.entries(held));
console.log(map.get("a") + 1, map.get("b") + 1);
