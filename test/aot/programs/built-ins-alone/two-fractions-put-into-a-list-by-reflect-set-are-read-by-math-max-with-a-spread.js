const held = [];
Reflect.set(held, 0, 1.5);
Reflect.set(held, 1, 2.5);
console.log(Math.max(...held) + 1, Math.min(...held) + 1);
