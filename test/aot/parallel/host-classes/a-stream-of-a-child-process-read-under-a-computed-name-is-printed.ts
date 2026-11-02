// A read under a name that the compiler does not know runs the getter of a host class, and what it answers is printed by util.inspect.
// Alone: what an executable leaves out goes by all that it holds
// The child is this program again. It is handed a word and ends at once.
if (process.argv.length > 2) process.exit(0);
const child = Bun.spawn([process.execPath, process.argv[1], "child"], { stdout: "pipe" }) as any;
console.log(Bun.inspect(child[JSON.parse('"stdout"')]).split(" ")[0]);
await child.exited;

export {};
