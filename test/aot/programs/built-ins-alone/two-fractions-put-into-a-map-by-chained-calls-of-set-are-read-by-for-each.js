const held = new Map().set("a", 1.5).set("b", 2.5);
held.forEach((value, key) => console.log(key, value + 1));
