// Members of process: programs events on. It prints what plain Bun prints.
if (process.argv.length > 99) new (require("node:events"))().on("a", () => {});
console.log("hello");
