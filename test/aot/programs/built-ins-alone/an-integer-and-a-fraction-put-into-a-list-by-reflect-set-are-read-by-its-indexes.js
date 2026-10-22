const held = [];
Reflect.set(held, 0, 7);
Reflect.set(held, 1, 1.5);
console.log(held.length);
console.log(held[0] + 1, held[1] + 1);
console.log(held[2] === undefined);
