const held = new Map().set("a", 7).set("b", 1.5);
console.log(held.get("a") + 1, held.get("b") + 1);
console.log(held.get("c") === undefined);
