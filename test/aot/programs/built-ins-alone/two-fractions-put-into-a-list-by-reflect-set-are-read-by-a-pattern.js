const held = [];
Reflect.set(held, 0, 1.5);
Reflect.set(held, 1, 2.5);
const [first, second, third] = held;
console.log(first + 1, second + 1);
console.log(third === undefined);
