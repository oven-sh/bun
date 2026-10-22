const held = {};
Reflect.set(held, "a", 1.5);
Reflect.set(held, "b", 2.5);
const map = new Map(Object.entries(held));
console.log(map.get("a") + 1, map.get("b") + 1);
