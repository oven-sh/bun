const held = {};
Reflect.set(held, "a", 7);
Reflect.set(held, "b", 1.5);
const list = Object.values(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
