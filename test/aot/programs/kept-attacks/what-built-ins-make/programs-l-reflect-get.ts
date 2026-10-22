// What built ins make: programs l reflect get. It prints what plain Bun prints.
// @ts-nocheck
if (process.argv.length > 99) {
  Reflect.get({ a: 1 }, "a");
}
console.log("hello");
