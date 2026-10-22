const held = [];
held.push("text");
held.push("more text");
const [first, second, third] = held;
console.log(first.length, second.length);
console.log(third === undefined);
