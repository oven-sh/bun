const held = new Map();
held.getOrInsertComputed("a", () => 7);
held.getOrInsertComputed("b", () => 1.5);
const list = [...held.entries()];
console.log(list[0][1] + 1, list[1][1] + 1);
