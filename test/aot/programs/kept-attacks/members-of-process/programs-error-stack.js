// Members of process: programs error stack. It prints what plain Bun prints.
if (process.argv.length > 99) console.log(new Error("a").stack);
console.log("hello");
