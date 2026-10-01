const proc = Bun.spawn({
  cmd: [process.execPath, "-e", "const s = 'x'.repeat(65536) + '\\n'; for (;;) process.stderr.write(s);"],
  stdin: "ignore",
  stdout: "pipe",
  stderr: "pipe",
  maxBuffer: 4 * 1024 * 1024,
  killSignal: "SIGKILL",
});
const t = performance.now();
const [out, err] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
console.log({ exitCode: proc.exitCode, signal: proc.signalCode, out: out.length, err: err.length, ms: Math.round(performance.now() - t) });
