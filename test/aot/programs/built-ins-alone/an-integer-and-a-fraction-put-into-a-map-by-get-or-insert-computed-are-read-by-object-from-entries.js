const held = new Map();
held.getOrInsertComputed("a", () => 7);
held.getOrInsertComputed("b", () => 1.5);
const made = Object.fromEntries(held);
console.log(made.a + 1, made.b + 1);
