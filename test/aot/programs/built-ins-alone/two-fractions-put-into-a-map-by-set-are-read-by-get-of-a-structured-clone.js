const held = new Map();
held.set("a", 1.5);
held.set("b", 2.5);
const copy = structuredClone(held);
console.log(copy.get("a") + 1, copy.get("b") + 1);
