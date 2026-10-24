// Walks over built ins: w rest. It prints what plain Bun prints.
const { nothingOfThisName, ...rest } = process;
console.log(Object.keys(rest).length > 3);
