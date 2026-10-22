const held = new Map();
held.set("a", 1.5);
held.set("b", 2.5);
const list = Array.from(held.values());
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
