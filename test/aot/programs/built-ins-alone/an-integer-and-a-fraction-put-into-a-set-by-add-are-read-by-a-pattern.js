const held = new Set();
held.add(7);
held.add(1.5);
const [first, second, third] = held;
console.log(first + 1, second + 1);
console.log(third === undefined);
