// The copy reads every member. What makes the members of `process` is in the executable, so the walk ends as in plain Bun.
console.log(Object.keys(Object.assign({}, process)).length > 3);
