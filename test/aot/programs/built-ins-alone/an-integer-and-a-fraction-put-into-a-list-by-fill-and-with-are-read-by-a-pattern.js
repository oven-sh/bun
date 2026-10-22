const held = new Array(2).fill(7).with(1, 1.5);
const [first, second, third] = held;
console.log(first + 1, second + 1);
console.log(third === undefined);
