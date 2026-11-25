// The own keys of Object come in the order in which its members are first read. A written map of Object.defineProperties reads that member, and not Object.defineProperty.
const made = Object.defineProperties({}, { a: { value: 1, enumerable: true }, b: { get() { return 2; } } });
console.log(made.a, made.b, Object.keys(made).join());
for (const key in Bun) break;
const { assign, ...rest } = Object;
console.log(Reflect.ownKeys(Object).join());
console.log(Object.getOwnPropertyNames(Object).join(), Object.keys(rest).length, typeof assign);
