const held = new Map();
held.set("a", 1.5);
held.set("b", 2.5);
console.log(Math.max(...held.values()) + 1);
