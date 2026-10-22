// Members of process: programs next tick. It prints what plain Bun prints.
if (process.argv.length > 99) process.nextTick((a) => a, { a: 1 });
console.log("hello");
