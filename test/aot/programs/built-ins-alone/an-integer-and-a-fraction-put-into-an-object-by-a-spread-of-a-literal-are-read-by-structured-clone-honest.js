const held = { ...{ a: 7 }, b: 1.5 };
const copy = structuredClone(held);
console.log(copy.a + 1, copy.b + 1);
