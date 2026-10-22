const held = {};
Reflect.defineProperty(held, "a", { value: 1.5, enumerable: true });
Reflect.defineProperty(held, "b", { value: 2.5, enumerable: true });
const map = new Map(Object.entries(held));
console.log(map.get("a") + 1, map.get("b") + 1);
