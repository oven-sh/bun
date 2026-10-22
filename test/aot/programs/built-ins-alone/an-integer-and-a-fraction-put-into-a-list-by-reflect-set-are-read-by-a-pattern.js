const held = [];
Reflect.set(held, 0, 7);
Reflect.set(held, 1, 1.5);
const [first, second, third] = held;
console.log(first + 1, second + 1);
console.log(third === undefined);
