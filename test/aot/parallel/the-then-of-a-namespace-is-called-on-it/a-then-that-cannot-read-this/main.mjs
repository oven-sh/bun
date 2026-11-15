// An arrow function has no `this` of its own: nothing but the names that are read is reached.
const { a } = await import("./other.mjs");
console.log(a);
