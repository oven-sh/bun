const held = Object.fromEntries([["a", 1.5], ["b", 2.5]]);
const copy = Object.assign({}, held);
console.log(copy.a + 1, copy.b + 1);
