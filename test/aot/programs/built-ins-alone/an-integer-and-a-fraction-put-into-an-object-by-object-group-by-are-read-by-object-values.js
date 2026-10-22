const groups = Object.groupBy([7, 1.5], (value, index) => (index === 0 ? "a" : "b"));
const held = { a: groups.a[0], b: groups.b[0] };
const list = Object.values(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
