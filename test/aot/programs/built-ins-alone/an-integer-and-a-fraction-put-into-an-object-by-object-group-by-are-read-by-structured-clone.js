const groups = Object.groupBy([7, 1.5], (value, index) => (index === 0 ? "a" : "b"));
const held = { a: groups.a[0], b: groups.b[0] };
const copy = structuredClone(held);
console.log(copy.a + 1, copy.b + 1);
