const held = Object.fromEntries([["a", 1.5], ["b", 2.5]]);
const { a, b, c } = held;
console.log(a + 1, b + 1);
console.log(c === undefined);
