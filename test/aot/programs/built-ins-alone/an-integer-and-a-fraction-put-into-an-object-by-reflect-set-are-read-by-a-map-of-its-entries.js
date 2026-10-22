const held = {};
Reflect.set(held, "a", 7);
Reflect.set(held, "b", 1.5);
const map = new Map(Object.entries(held));
console.log(map.get("a") + 1, map.get("b") + 1);
