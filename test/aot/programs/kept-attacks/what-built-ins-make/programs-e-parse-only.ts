// What built ins make: programs e parse only. It prints what plain Bun prints.
// @ts-nocheck
const v = JSON.parse(process.argv[2] ?? "1"); process.exitCode = v ? 0 : 0;
console.log("hello");
