Bun.argv.extra = Number(process.argv[2] ?? 1);
function read() { return process.argv.extra + " " + process.argv.includes("x"); }
console.log(read());
