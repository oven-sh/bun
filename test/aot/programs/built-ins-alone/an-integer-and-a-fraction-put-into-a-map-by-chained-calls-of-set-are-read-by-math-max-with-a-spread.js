const held = new Map().set("a", 7).set("b", 1.5);
console.log(Math.max(...held.values()) + 1);
