// The copy reads every member. What makes the members of `process` is in the executable, so the walk ends as in plain Bun.
const copy = { ...process };
console.log(Object.keys(copy).length > 3);
