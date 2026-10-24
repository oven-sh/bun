// A bigint literal as a property name names the property by its decimal digits. TypeScript reports it (1539), and the build accepts it.
console.log(Object.keys({ 1n: "a", 2n: "b" }));
