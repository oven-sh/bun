const held = [];
held.unshift(1.5);
held.unshift(7);
console.log(Reflect.get(held, 0) + 1, Reflect.get(held, "1") + 1);
