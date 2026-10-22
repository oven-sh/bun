const held = new Set();
held.add("text");
held.add("more text");
const [first, second, third] = held;
console.log(first.length, second.length);
console.log(third === undefined);
