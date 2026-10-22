const held = new Map();
held.set("a", "text");
held.set("b", "more text");
const made = Object.fromEntries(held);
console.log(made.a.length, made.b.length);
