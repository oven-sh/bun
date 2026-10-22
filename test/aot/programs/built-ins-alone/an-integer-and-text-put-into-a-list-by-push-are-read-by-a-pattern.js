const held = [];
held.push(7);
held.push("text");
const [first, second, third] = held;
console.log(first + 1, second.length);
console.log(third === undefined);
