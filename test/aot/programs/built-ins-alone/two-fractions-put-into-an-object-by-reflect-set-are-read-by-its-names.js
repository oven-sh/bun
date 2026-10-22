const held = {};
Reflect.set(held, "a", 1.5);
Reflect.set(held, "b", 2.5);
console.log(held.a + 1, held.b + 1);
console.log(held.c === undefined);
