const held = new Map();
held.set("a", 7);
held.set("b", "text");
console.log(held.get("a") + 1, held.get("b").length);
console.log(held.get("c") === undefined);
