const held = {};
Reflect.defineProperty(held, "a", { value: 7, enumerable: true });
Reflect.defineProperty(held, "b", { value: 1.5, enumerable: true });
console.log(held.a + 1, held.b + 1);
console.log(held.c === undefined);
