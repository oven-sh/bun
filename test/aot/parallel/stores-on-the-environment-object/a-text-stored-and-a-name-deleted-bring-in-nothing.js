// The host warns of a value that is no string, number or boolean. A text, a number, a boolean and a deletion bring in none of what prints a warning.
// STATISTIC: ImageFunctionsEmitted <= 5
process.env.MADE_UP_MODE = "test";
process.env.MADE_UP_LIMIT = 5;
process.env.MADE_UP_FLAG = true;
process.env.MADE_UP_MODE ??= "other";
Bun.env.MADE_UP_OTHER = "set by the other name";
console.log(process.env.MADE_UP_MODE);
console.log(process.env.MADE_UP_LIMIT);
console.log(process.env.MADE_UP_FLAG);
console.log(process.env.MADE_UP_OTHER);
delete process.env.MADE_UP_MODE;
console.log(process.env.MADE_UP_MODE);
