const held = new Map();
held.set(1.5, "a");
held.set(undefined, "b");
held.forEach((value, key) => console.log(typeof key, key));
