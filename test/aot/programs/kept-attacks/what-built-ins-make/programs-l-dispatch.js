// What built ins make: programs l dispatch. It prints what plain Bun prints.
if (process.argv.length > 99) {
  new EventTarget().dispatchEvent(new Event("a"));
}
console.log("hello");
