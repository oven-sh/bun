const held = [];
Reflect.set(held, 0, 7);
Reflect.set(held, 1, 1.5);
const list = structuredClone(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
