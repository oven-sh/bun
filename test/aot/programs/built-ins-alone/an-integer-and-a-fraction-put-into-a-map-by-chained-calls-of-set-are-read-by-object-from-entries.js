const held = new Map().set("a", 7).set("b", 1.5);
const made = Object.fromEntries(held);
console.log(made.a + 1, made.b + 1);
