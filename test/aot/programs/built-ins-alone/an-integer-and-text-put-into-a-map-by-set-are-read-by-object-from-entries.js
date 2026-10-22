const held = new Map();
held.set("a", 7);
held.set("b", "text");
const made = Object.fromEntries(held);
console.log(made.a + 1, made.b.length);
