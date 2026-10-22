const held = new Map().set("a", 1.5).set("b", 2.5);
console.log(Math.max(...held.values()) + 1);
