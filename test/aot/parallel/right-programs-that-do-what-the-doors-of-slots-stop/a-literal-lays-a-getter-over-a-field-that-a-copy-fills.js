let count = 0;
const made = Object.assign({}, { get a() { return ++count; } });
console.log(made.a, made.a, count);
