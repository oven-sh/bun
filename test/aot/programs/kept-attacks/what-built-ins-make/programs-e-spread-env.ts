// What built ins make: programs e spread env. It prints what plain Bun prints.
// @ts-nocheck
console.log(Object.keys({ ...process.env }).length > 0);
console.log("hello");
