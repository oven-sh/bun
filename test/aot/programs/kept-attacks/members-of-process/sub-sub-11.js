// Members of process: sub sub. It prints what plain Bun prints.
if (process.argv.length > 99) {
  class W extends WeakMap {} new W().set(Array.prototype, 1);
}
console.log("hello");
