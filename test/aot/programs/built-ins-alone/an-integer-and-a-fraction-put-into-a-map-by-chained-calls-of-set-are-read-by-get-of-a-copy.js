const held = new Map().set("a", 7).set("b", 1.5);
const copy = new Map(held);
console.log(copy.get("a") + 1, copy.get("b") + 1);
