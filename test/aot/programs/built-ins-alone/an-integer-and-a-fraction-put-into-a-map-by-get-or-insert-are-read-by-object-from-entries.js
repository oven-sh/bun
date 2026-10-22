const held = new Map();
held.getOrInsert("a", 7);
held.getOrInsert("b", 1.5);
const made = Object.fromEntries(held);
console.log(made.a + 1, made.b + 1);
