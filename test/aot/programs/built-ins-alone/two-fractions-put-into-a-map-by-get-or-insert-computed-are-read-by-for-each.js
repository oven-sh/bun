const held = new Map();
held.getOrInsertComputed("a", () => 1.5);
held.getOrInsertComputed("b", () => 2.5);
held.forEach((value, key) => console.log(key, value + 1));
