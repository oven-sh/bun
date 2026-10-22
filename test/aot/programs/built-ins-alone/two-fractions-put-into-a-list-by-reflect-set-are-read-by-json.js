const held = [];
Reflect.set(held, 0, 1.5);
Reflect.set(held, 1, 2.5);
const list = JSON.parse(JSON.stringify(held));
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
