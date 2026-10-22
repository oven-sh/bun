const held = {};
Reflect.set(held, "a", 7);
Reflect.set(held, "b", 1.5);
console.log(held.a + 1, held.b + 1);
console.log(held.c === undefined);
