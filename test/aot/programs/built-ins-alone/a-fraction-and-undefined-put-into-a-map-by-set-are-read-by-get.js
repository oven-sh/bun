const held = new Map();
held.set("a", 1.5);
held.set("b", undefined);
console.log(held.get("a") + 1, held.get("b") === undefined);
console.log(held.get("c") === undefined);
