const held = new Set();
held.add(7);
held.add("text");
const [first, second, third] = held;
console.log(first + 1, second.length);
console.log(third === undefined);
