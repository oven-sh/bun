const held = new Map();
held.set("a", 7);
held.set("b", 8);
console.log(held.get("a") + 1, held.get("b") + 1);
console.log(held.get("c") === undefined);
