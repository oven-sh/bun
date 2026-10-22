const held = new Map();
held.set("a", 7);
held.set("b", 8);
const made = Object.fromEntries(held);
console.log(made.a + 1, made.b + 1);
