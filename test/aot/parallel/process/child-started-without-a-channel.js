// A child has a channel where the options of Bun.spawn have `ipc`. These have none: nothing of what the channel needs is compiled.
// STATISTIC: ImageFunctionsEmitted <= 20
// The child is this program again. It is handed a word and ends at once.
if (process.argv.length > 2) process.exit(0);
const again = [process.execPath, process.argv[1], "child"];
Bun.spawn(again, { stdout: "ignore" });
Bun.spawn({ cmd: again, stdout: "ignore" });
console.log("started");
