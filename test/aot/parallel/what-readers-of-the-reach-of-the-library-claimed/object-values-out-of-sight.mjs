function apply(f, x) { return f(x); }
console.log(apply(Object.keys, { a: 1 }).length, apply(Object.values, Bun).length > 20);
