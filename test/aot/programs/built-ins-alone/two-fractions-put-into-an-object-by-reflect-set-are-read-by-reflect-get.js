const held = {};
Reflect.set(held, "a", 1.5);
Reflect.set(held, "b", 2.5);
console.log(Reflect.get(held, "a") + 1, Reflect.get(held, "b") + 1);
