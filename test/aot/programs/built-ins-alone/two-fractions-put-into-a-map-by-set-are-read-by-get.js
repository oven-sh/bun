const held = new Map();
held.set("a", 1.5);
held.set("b", 2.5);
console.log(held.get("a") + 1, held.get("b") + 1);
console.log(held.get("c") === undefined);
