const held = { ...{ a: 1.5 }, b: 2.5 };
const copy = structuredClone(held);
console.log(copy.a + 1, copy.b + 1);
