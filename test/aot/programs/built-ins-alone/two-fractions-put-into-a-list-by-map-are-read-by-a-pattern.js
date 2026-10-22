const held = [0, 1].map(index => (index === 0 ? 1.5 : 2.5));
const [first, second, third] = held;
console.log(first + 1, second + 1);
console.log(third === undefined);
