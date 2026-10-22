const held = new Map();
held.set(7, "a");
held.set("text", "b");
held.forEach((value, key) => console.log(typeof key, key));
