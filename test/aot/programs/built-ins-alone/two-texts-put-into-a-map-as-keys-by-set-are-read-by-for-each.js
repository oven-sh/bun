const held = new Map();
held.set("text", "a");
held.set("more text", "b");
held.forEach((value, key) => console.log(key.length));
