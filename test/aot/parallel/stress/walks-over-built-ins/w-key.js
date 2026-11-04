// Walks over built ins: w key. It prints what plain Bun prints.
const key = process.argv[2] ?? "pid";
console.log(typeof process[key]);
