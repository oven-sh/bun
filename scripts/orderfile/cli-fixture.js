// The interactive workload for scripts/orderfile/generate.ts. Reads stdin,
// writes stdout, drives readline. Traced twice: once on a pipe, once on a
// terminal (ptyrun.c), which is the only way to reach isatty, the window size,
// raw mode, and readline's line editor with its cursor escapes.
//
// Fed "world\none\ntwo\nquit\n". `quit` is what makes it exit, so it never has
// to wait for an end-of-input that a terminal may not deliver.
const { createInterface } = require("node:readline");

const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
process.stdout.write(`tty=${terminal} ${process.stdout.columns ?? 0}x${process.stdout.rows ?? 0}\n`);
process.stdout.write(Buffer.alloc(8192, 0x2e)); // more than one write's worth
if (terminal) {
  process.stdout.write(`\ncolors=${process.stdout.hasColors?.(256)}\n`);
  process.stdin.setRawMode(true);
  process.stdin.setRawMode(false);
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal, prompt: "> " });
let lines = 0;
rl.question("\nname? ", name => {
  process.stdout.write(`hi ${name.trim()}\n`);
  rl.on("line", line => {
    process.stdout.write(`${++lines}: ${line.trim()}\n`);
    if (line.trim() === "quit") return rl.close();
    rl.prompt();
  });
  rl.prompt();
});
rl.on("close", () => process.stdout.write(`read ${lines} lines\n`));
