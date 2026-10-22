const held = new Map();
held.set("a", "text");
held.set("b", "more text");
const copy = new Map(held);
console.log(copy.get("a").length, copy.get("b").length);
