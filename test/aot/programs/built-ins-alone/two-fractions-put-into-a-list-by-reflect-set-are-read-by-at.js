const held = [];
Reflect.set(held, 0, 1.5);
Reflect.set(held, 1, 2.5);
console.log(held.at(0) + 1, held.at(-1) + 1);
