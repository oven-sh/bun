const groups = Object.groupBy([7, 1.5], (value, index) => (index === 0 ? "a" : "b"));
const held = { a: groups.a[0], b: groups.b[0] };
for (const key of Object.keys(held)) console.log(key, held[key] + 1);
