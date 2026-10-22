const held = new Map(Object.entries({ a: 1.5, b: 2.5 }));
const copy = structuredClone(held);
console.log(copy.get("a") + 1, copy.get("b") + 1);
