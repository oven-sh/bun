const held = new Map();
held.set("a", 7);
held.set("b", 8);
const copy = structuredClone(held);
console.log(copy.get("a") + 1, copy.get("b") + 1);
