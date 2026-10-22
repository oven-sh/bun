const held = new Map(Object.entries({ a: 1.5, b: 2.5 }));
console.log(held.get("a") + 1, held.get("b") + 1);
console.log(held.get("c") === undefined);
