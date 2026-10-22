const held = {};
Object.defineProperty(held, "a", { value: 1.5, enumerable: true });
Object.defineProperty(held, "b", { value: 2.5, enumerable: true });
console.log(held.a + 1, held.b + 1);
console.log(held.c === undefined);
