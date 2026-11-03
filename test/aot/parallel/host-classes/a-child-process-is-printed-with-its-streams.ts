// Bun.inspect asks a child process for its `stdout`, and the first to ask makes the stream.
// Alone: what an executable leaves out goes by all that it holds
// The child is this program again. It is handed a word and ends at once.
if (process.argv.length > 2) process.exit(0);
const child = Bun.spawn([process.execPath, process.argv[1], "child"], { stdout: "pipe" });
const text = Bun.inspect(child);
console.log(text.split("\n")[0], text.includes("stdout: ReadableStream {"), text.includes("exited: Promise {"));
await child.exited;

export {};
