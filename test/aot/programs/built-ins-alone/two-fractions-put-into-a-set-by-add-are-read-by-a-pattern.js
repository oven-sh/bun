const held = new Set();
held.add(1.5);
held.add(2.5);
const [first, second, third] = held;
console.log(first + 1, second + 1);
console.log(third === undefined);
