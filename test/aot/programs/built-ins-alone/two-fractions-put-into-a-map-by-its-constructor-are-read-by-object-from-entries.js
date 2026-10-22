const held = new Map([["a", 1.5], ["b", 2.5]]);
const made = Object.fromEntries(held);
console.log(made.a + 1, made.b + 1);
