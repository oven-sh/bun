const held = Object.assign([], { 0: 1.5, 1: 2.5 });
const [first, second, third] = held;
console.log(first + 1, second + 1);
console.log(third === undefined);
