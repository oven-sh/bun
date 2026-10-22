const groups = Object.groupBy([1.5, 2.5], (value, index) => (index === 0 ? "a" : "b"));
const held = { a: groups.a[0], b: groups.b[0] };
console.log(Object.getOwnPropertyDescriptor(held, "a").value + 1, Object.getOwnPropertyDescriptor(held, "b").value + 1);
