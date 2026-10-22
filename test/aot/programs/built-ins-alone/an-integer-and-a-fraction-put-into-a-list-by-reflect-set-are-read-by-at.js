const held = [];
Reflect.set(held, 0, 7);
Reflect.set(held, 1, 1.5);
console.log(held.at(0) + 1, held.at(-1) + 1);
