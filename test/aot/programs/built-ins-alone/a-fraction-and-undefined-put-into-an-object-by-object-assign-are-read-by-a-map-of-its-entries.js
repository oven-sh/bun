const held = Object.assign({}, { a: 1.5 }, { b: undefined });
const map = new Map(Object.entries(held));
console.log(map.get("a") + 1, map.get("b") === undefined);
