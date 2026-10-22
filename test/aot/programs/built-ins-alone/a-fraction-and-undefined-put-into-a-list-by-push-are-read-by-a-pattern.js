const held = [];
held.push(1.5);
held.push(undefined);
const [first, second, third] = held;
console.log(first + 1, second === undefined);
console.log(third === undefined);
