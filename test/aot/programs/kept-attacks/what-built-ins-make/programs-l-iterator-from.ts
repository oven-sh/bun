// What built ins make: programs l iterator from. It prints what plain Bun prints.
// @ts-nocheck
if (process.argv.length > 99) {
  Iterator.from({ next() { return { done: true }; } }).next();
}
console.log("hello");
