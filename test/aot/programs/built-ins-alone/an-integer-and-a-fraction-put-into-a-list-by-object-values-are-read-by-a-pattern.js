const held = Object.values({ a: 7, b: 1.5 });
const [first, second, third] = held;
console.log(first + 1, second + 1);
console.log(third === undefined);
