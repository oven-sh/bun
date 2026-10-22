const held = new Set();
held.add(1.5);
held.add(undefined);
const [first, second, third] = held;
console.log(first + 1, second === undefined);
console.log(third === undefined);
