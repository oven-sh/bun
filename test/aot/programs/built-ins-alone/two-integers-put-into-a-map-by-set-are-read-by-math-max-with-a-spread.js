const held = new Map();
held.set("a", 7);
held.set("b", 8);
console.log(Math.max(...held.values()) + 1);
