// Members of process: programs util promisify. It prints what plain Bun prints.
if (process.argv.length > 99) require("node:util").promisify((cb) => cb())();
console.log("hello");
