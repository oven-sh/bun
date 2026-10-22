const held = new Map().set("a", 1.5).set("b", 2.5);
const made = Object.fromEntries(held);
console.log(made.a + 1, made.b + 1);
