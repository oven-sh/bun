const held = new Map();
held.set("a", 1.5);
held.set("b", 2.5);
held.forEach((value, key) => console.log(key, value + 1));
