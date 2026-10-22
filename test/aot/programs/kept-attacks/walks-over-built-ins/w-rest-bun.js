// Walks over built ins: w rest bun. It prints what plain Bun prints.
const { nothingOfThisName, ...rest } = Bun;
console.log(Object.keys(rest).length > 3);
