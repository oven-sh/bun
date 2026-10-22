const held = [0, 1].map(index => (index === 0 ? 7 : 1.5));
const [first, second, third] = held;
console.log(first + 1, second + 1);
console.log(third === undefined);
