const groups = Object.groupBy([7, 1.5], (value, index) => (index === 0 ? "a" : "b"));
const held = { a: groups.a[0], b: groups.b[0] };
const { a, b, c } = held;
console.log(a + 1, b + 1);
console.log(c === undefined);
