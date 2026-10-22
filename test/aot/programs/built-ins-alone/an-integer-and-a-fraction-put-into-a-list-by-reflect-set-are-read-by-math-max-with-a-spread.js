const held = [];
Reflect.set(held, 0, 7);
Reflect.set(held, 1, 1.5);
console.log(Math.max(...held) + 1, Math.min(...held) + 1);
