const held = new Map().set("a", 1.5).set("b", 2.5);
const copy = structuredClone(held);
console.log(copy.get("a") + 1, copy.get("b") + 1);
