const held = new Map();
held.getOrInsertComputed("a", () => 7);
held.getOrInsertComputed("b", () => 1.5);
console.log(Math.max(...held.values()) + 1);
