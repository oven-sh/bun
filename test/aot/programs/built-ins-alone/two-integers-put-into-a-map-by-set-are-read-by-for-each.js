const held = new Map();
held.set("a", 7);
held.set("b", 8);
held.forEach((value, key) => console.log(key, value + 1));
