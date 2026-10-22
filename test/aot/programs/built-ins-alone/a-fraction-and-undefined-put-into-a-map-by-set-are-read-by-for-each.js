const held = new Map();
held.set("a", 1.5);
held.set("b", undefined);
held.forEach((value, key) => console.log(key, typeof value, value));
