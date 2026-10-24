// Members of process: sub sub. It prints what plain Bun prints.
if (process.argv.length > 99) {
  class E extends Error {} console.log(new E("a").message);
}
console.log("hello");
