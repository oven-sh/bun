// Members of process: programs process stdout. It prints what plain Bun prints.
const K = process.argv[2];
if (process.argv.length > 99) process.stdout.write(K);
console.log("hello");
