const source = { ["__proto__"]: "a property", kept: 1, dropped: 2 };
const { dropped, ...rest } = source;
console.log(Object.hasOwn(rest, "__proto__"), Object.getPrototypeOf(rest) === Object.prototype, rest.kept, rest.dropped);
