const held = new Map([["a", 7], ["b", 1.5]]);
const copy = new Map(held);
console.log(copy.get("a") + 1, copy.get("b") + 1);
