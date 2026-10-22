const held = new Map().set("a", 7).set("b", 1.5);
held.forEach((value, key) => console.log(key, value + 1));
