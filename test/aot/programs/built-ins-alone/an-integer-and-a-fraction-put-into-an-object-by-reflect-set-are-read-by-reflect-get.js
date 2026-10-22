const held = {};
Reflect.set(held, "a", 7);
Reflect.set(held, "b", 1.5);
console.log(Reflect.get(held, "a") + 1, Reflect.get(held, "b") + 1);
