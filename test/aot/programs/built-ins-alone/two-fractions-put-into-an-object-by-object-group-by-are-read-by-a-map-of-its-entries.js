const groups = Object.groupBy([1.5, 2.5], (value, index) => (index === 0 ? "a" : "b"));
const held = { a: groups.a[0], b: groups.b[0] };
const map = new Map(Object.entries(held));
console.log(map.get("a") + 1, map.get("b") + 1);
