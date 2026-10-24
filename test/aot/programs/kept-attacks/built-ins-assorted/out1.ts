// Built ins assorted, one probe of many. It prints what plain Bun prints.
process.stdout.write("x\n");
process.stderr.write("y\n");
console.log(typeof process.stdin.on, process.stdout.isTTY === undefined || typeof process.stdout.isTTY === "boolean");
export {};
