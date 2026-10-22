const held = { ...{ a: 1.5 }, b: 2.5 };
const map = new Map(Object.entries(held));
console.log(map.get("a") + 1, map.get("b") + 1);
