// What built ins make: programs l abort. It prints what plain Bun prints.
if (process.argv.length > 99) {
  new AbortController().abort();
}
console.log("hello");
