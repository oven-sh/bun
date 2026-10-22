const held = new Map();
held.getOrInsertComputed("a", () => 7);
held.getOrInsertComputed("b", () => 1.5);
console.log(held.get("a") + 1, held.get("b") + 1);
console.log(held.get("c") === undefined);
