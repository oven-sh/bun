const held = new Map();
held.set(1.5, "a");
held.set(2.5, "b");
const list = Array.from(held.keys());
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
