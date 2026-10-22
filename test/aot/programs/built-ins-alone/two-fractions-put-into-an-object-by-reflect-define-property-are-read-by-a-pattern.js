const held = {};
Reflect.defineProperty(held, "a", { value: 1.5, enumerable: true });
Reflect.defineProperty(held, "b", { value: 2.5, enumerable: true });
const { a, b, c } = held;
console.log(a + 1, b + 1);
console.log(c === undefined);
