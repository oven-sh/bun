const held = new Map();
held.set("a", 7);
held.set("b", 1.5);
console.log(Math.max(...held.values()) + 1);
