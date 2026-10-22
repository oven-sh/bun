const held = Object.values({ a: 1.5, b: 2.5 });
const [first, second, third] = held;
console.log(first + 1, second + 1);
console.log(third === undefined);
