// process.stdout, stderr and stdin are written to, asked and listened to.
process.stdout.write("x\n");
process.stderr.write("");
console.log(typeof process.stdin.on, process.stdout.isTTY === undefined || typeof process.stdout.isTTY === "boolean");
process.stdin.on("data", () => {});
process.stdin.pause();
export {};
