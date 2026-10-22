const held = [];
held.push(7);
held.push(8);
console.log(Reflect.get(held, 0) + 1, Reflect.get(held, "1") + 1);
