const held = new Map();
held.set("a", "text");
held.set("b", "more text");
console.log(held.get("a").length, held.get("b").length);
console.log(held.get("c") === undefined);
