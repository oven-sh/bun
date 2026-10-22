const held = new Map();
held.set("a", "text");
held.set("b", "more text");
held.forEach((value, key) => console.log(key, value.length));
