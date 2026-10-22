const held = new Map();
held.set("a", 1.5);
held.set("b", undefined);
const made = Object.fromEntries(held);
console.log(made.a + 1, made.b === undefined);
