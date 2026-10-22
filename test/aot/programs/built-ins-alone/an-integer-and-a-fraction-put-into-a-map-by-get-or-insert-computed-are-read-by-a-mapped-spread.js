const held = new Map();
held.getOrInsertComputed("a", () => 7);
held.getOrInsertComputed("b", () => 1.5);
const list = [...held].map(([key, value]) => value);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
