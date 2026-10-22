const held = new Map();
held.set("a", 7);
held.set("b", "text");
const copy = new Map(held);
console.log(copy.get("a") + 1, copy.get("b").length);
