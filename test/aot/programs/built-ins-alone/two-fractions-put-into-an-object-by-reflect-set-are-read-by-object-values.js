const held = {};
Reflect.set(held, "a", 1.5);
Reflect.set(held, "b", 2.5);
const list = Object.values(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
