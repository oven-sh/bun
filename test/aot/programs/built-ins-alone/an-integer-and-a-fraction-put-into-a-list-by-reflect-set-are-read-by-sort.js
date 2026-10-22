const held = [];
Reflect.set(held, 0, 7);
Reflect.set(held, 1, 1.5);
held.sort((left, right) => left - right);
console.log(held[0] + 1, held[1] + 1);
