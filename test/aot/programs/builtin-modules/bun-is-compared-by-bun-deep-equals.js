// The comparison reads every member. What makes the members of `Bun` is in the executable, so the walk ends as in plain Bun.
console.log(Bun.deepEquals(Bun, { a: 1 }), Bun.deepEquals({ a: Bun }, { a: { b: 1 } }));
