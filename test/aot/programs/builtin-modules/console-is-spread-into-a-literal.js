// The copy reads every member. What makes the members of `console` is in the executable, so the walk ends as in plain Bun.
const copy = { ...console };
console.log(Object.keys(copy).length > 3);
