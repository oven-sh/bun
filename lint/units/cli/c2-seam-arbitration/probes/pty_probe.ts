let out = "";
const proc = Bun.spawn({
  cmd: [process.execPath, "-e", "process.stderr.write('err-tty=' + process.stderr.isTTY + ' out-tty=' + process.stdout.isTTY + '\\nline2\\n')"],
  env: { ...process.env, NO_COLOR: "1" },
  terminal: { cols: 80, rows: 24, data(_t, chunk) { out += Buffer.from(chunk).toString("latin1"); } },
});
const code = await proc.exited;
proc.terminal?.close();
console.log(JSON.stringify({ code, out }));
