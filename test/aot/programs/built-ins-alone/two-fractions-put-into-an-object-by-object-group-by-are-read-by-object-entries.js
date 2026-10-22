const groups = Object.groupBy([1.5, 2.5], (value, index) => (index === 0 ? "a" : "b"));
const held = { a: groups.a[0], b: groups.b[0] };
for (const [key, value] of Object.entries(held)) console.log(key, value + 1);
