const held = [];
held.unshift(2.5);
held.unshift(1.5);
const [first, second, third] = held;
console.log(first + 1, second + 1);
console.log(third === undefined);
