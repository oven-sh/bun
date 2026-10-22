const held = new Map();
held.getOrInsertComputed("a", () => 7);
held.getOrInsertComputed("b", () => 1.5);
held.forEach((value, key) => console.log(key, value + 1));
