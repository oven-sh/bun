const held = [0].flatMap(() => [7, 1.5]);
const [first, second, third] = held;
console.log(first + 1, second + 1);
console.log(third === undefined);
