const held = {};
Reflect.defineProperty(held, "a", { value: 1.5, enumerable: true });
Reflect.defineProperty(held, "b", { value: 2.5, enumerable: true });
const copy = { ...held };
console.log(copy.a + 1, copy.b + 1);
