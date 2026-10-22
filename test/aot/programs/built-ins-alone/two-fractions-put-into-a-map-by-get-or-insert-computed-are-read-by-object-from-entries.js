const held = new Map();
held.getOrInsertComputed("a", () => 1.5);
held.getOrInsertComputed("b", () => 2.5);
const made = Object.fromEntries(held);
console.log(made.a + 1, made.b + 1);
