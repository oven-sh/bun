const groups = Object.groupBy([7, 1.5], (value, index) => (index === 0 ? "a" : "b"));
const held = { a: groups.a[0], b: groups.b[0] };
console.log(Reflect.get(held, "a") + 1, Reflect.get(held, "b") + 1);
