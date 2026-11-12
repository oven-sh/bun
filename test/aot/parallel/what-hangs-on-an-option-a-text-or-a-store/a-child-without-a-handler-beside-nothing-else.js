// STATISTIC: ImageFunctionsEmitted <= 600
// The child is this program again. It is handed a word and ends at once.
if (process.argv.length > 2) process.exit(0);
Bun.spawn([process.execPath, process.argv[1], "child"], { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
console.log("started");
