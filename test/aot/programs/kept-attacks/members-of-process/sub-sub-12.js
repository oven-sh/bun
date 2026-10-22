// Members of process: sub sub. It prints what plain Bun prints.
if (process.argv.length > 99) {
  class M extends Map {} Map.prototype.set.call(new M(), Array.prototype, 1);
}
console.log("hello");
