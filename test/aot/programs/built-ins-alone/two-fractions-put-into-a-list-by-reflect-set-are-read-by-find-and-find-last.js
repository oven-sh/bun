const held = [];
Reflect.set(held, 0, 1.5);
Reflect.set(held, 1, 2.5);
console.log(held.find(() => true) + 1, held.findLast(() => true) + 1);
