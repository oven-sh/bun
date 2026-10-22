// What built ins make: programs l glob. It prints what plain Bun prints.
// @ts-nocheck
if (process.argv.length > 99) {
  new Bun.Glob("*").scanSync(".");
}
console.log("hello");
