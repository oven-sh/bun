const held = new Map();
held.set("a", 7);
held.set("b", "text");
const list = Array.from(held.values());
console.log(list.length);
console.log(list[0] + 1, list[1].length);
