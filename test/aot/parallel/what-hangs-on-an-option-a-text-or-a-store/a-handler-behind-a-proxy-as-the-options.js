// The child is Bun itself, which runs one line: so nothing in this program but the handler asks for the channel. The line is put together at run time.
// It sends bytes: native code has the library restore them on this side.
// Were the child this program again, it would have been handed words: it ends at once and starts nothing.
if (process.argv.length > 2) process.exit(0);
const command = [process.execPath, "-e", ["process", "send"].join(".") + '?.({ bytes: Buffer.from("from the child") })'];
const env = { BUN_BE_BUN: "1" };
const options = new Proxy(
  { stdout: "ignore", env },
  {
    get(target, key) {
      return key === ["ip", "c"].join("") ? message => console.log("heard", String(message.bytes)) : target[key];
    },
  },
);
const child = Bun.spawn(command, options);
await child.exited;
console.log("ended", child.exitCode);
