const held = {};
Reflect.defineProperty(held, "a", { value: 1.5, enumerable: true });
Reflect.defineProperty(held, "b", { value: 2.5, enumerable: true });
const list = Object.values(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
