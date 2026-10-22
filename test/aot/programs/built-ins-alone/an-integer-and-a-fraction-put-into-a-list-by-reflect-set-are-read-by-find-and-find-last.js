const held = [];
Reflect.set(held, 0, 7);
Reflect.set(held, 1, 1.5);
console.log(held.find(() => true) + 1, held.findLast(() => true) + 1);
