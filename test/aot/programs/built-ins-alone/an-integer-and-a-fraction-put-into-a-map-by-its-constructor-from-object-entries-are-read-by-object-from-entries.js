const held = new Map(Object.entries({ a: 7, b: 1.5 }));
const made = Object.fromEntries(held);
console.log(made.a + 1, made.b + 1);
