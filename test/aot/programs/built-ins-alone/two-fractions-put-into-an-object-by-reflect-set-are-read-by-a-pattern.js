const held = {};
Reflect.set(held, "a", 1.5);
Reflect.set(held, "b", 2.5);
const { a, b, c } = held;
console.log(a + 1, b + 1);
console.log(c === undefined);
