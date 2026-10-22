const held = new Map();
held.set("a", 7);
held.set("b", 8);
const list = [...held].map(([key, value]) => value);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
