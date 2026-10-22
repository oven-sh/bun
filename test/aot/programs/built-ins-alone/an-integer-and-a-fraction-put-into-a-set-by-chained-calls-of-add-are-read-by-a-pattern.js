const held = new Set().add(7).add(1.5);
const [first, second, third] = held;
console.log(first + 1, second + 1);
console.log(third === undefined);
