const held = new Map();
held.getOrInsert("a", 1.5);
held.getOrInsert("b", 2.5);
const made = Object.fromEntries(held);
console.log(made.a + 1, made.b + 1);
