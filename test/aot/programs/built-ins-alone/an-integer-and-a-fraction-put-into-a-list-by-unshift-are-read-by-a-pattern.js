const held = [];
held.unshift(1.5);
held.unshift(7);
const [first, second, third] = held;
console.log(first + 1, second + 1);
console.log(third === undefined);
