const held = [];
Reflect.set(held, 0, 7);
Reflect.set(held, 1, 1.5);
console.log(held.shift() + 1, held.pop() + 1);
console.log(held.length, held.pop() === undefined);
