const held = [];
Reflect.set(held, 0, 7);
Reflect.set(held, 1, 1.5);
let total = 0;
for (let index = 0; index < held.length; index++) total += held[index];
console.log(total);
