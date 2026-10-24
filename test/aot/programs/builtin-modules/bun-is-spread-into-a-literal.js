// The copy reads every member. What makes the members of `Bun` is in the executable, so the walk ends as in plain Bun.
const copy = { ...Bun };
console.log(Object.keys(copy).length > 3);
