const held = {};
Reflect.set(held, "a", 7);
Reflect.set(held, "b", 1.5);
const { a, b, c } = held;
console.log(a + 1, b + 1);
console.log(c === undefined);
