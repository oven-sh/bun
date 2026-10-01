async function run(label: string, cmd: string[], opts: any = {}) {
  const t0 = performance.now();
  const deadline = opts.timeoutMs !== undefined ? AbortSignal.timeout(opts.timeoutMs) : undefined;
  let proc;
  try {
    proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe", stdin: "ignore", signal: deadline, killSignal: "SIGKILL", env: { ...process.env } });
  } catch (e) {
    console.log(label, "spawn threw", String(e));
    return;
  }
  const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  console.log(label, JSON.stringify({ code, exitCode: proc.exitCode, signalCode: proc.signalCode, killed: proc.killed, aborted: deadline?.aborted, ms: Math.round(performance.now() - t0), out: out.slice(0, 60), err: err.slice(0, 80) }));
}
await Bun.write("/tmp/ccds-facts/f_exit7.ts", "console.error('bye'); process.exit(7);");
await Bun.write("/tmp/ccds-facts/f_abort.ts", "process.abort();");
await Bun.write("/tmp/ccds-facts/f_segv.ts", "process.kill(process.pid, 'SIGSEGV'); await new Promise(r => setInterval(r, 100000));");
await Bun.write("/tmp/ccds-facts/f_kill.ts", "process.kill(process.pid, 'SIGKILL'); await new Promise(r => setInterval(r, 100000));");
await Bun.write("/tmp/ccds-facts/f_hang.ts", "console.log('hanging'); setInterval(() => {}, 100000);");
await Bun.write("/tmp/ccds-facts/f_args.ts", "console.log(JSON.stringify(process.argv.slice(2)));");
const bun = process.execPath;
await run("exit7", [bun, "/tmp/ccds-facts/f_exit7.ts"]);
await run("abort", [bun, "/tmp/ccds-facts/f_abort.ts"]);
await run("segv", [bun, "/tmp/ccds-facts/f_segv.ts"]);
await run("kill", [bun, "/tmp/ccds-facts/f_kill.ts"]);
await run("hang", [bun, "/tmp/ccds-facts/f_hang.ts"], { timeoutMs: 300 });
await run("hang1", [bun, "/tmp/ccds-facts/f_hang.ts"], { timeoutMs: 1 });
await run("args", [bun, "/tmp/ccds-facts/f_args.ts", "--lint", "a.ts", "b.ts"]);
await run("missing", ["/nonexistent/binary", "x"]);
