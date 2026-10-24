// The copy reads every member. What makes the members of `process` is in the executable, so the walk ends as in plain Bun.
const { nothingOfThisName, ...rest } = process;
console.log(Object.keys(rest).length > 3);
