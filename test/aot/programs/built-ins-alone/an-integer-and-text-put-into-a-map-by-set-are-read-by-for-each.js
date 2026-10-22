const held = new Map();
held.set("a", 7);
held.set("b", "text");
held.forEach((value, key) => console.log(key, typeof value, value));
