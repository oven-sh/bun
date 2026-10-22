// What built ins make: programs e read env. It prints what plain Bun prints.
// @ts-nocheck
const home = process.env.HOME; process.exitCode = home === undefined ? 1 : 0;
console.log("hello");
