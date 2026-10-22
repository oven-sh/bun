const held = [];
Reflect.set(held, 0, 1.5);
Reflect.set(held, 1, 2.5);
console.log(Reflect.get(held, 0) + 1, Reflect.get(held, "1") + 1);
