const held = Object.create(null, { a: { value: 1.5, enumerable: true }, b: { value: 2.5, enumerable: true } });
const map = new Map(Object.entries(held));
console.log(map.get("a") + 1, map.get("b") + 1);
