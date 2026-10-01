const exe = process.execPath;
async function run(label: string, cmd: string[], opts: any = {}) {
  const t = performance.now();
  let p;
  try {
    p = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe", stdin: "ignore", ...opts });
  } catch (e: any) {
    console.log(label, "spawn threw", e?.code, String(e?.message).slice(0, 80));
    return;
  }
  const [o, e, c] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  console.log(label, JSON.stringify({ exited: c, exitCode: p.exitCode, signalCode: p.signalCode, killed: p.killed, ms: Math.round(performance.now() - t), stdout: o.slice(0, 60), stderr: e.slice(0, 100) }));
}
await run("timeout", [exe, "-e", "while(true){}"], { timeout: 300, killSignal: "SIGKILL" });
await run("segv", [exe, "-e", "process.kill(process.pid, 'SIGSEGV')"]);
await run("abort", [exe, "-e", "process.abort()"]);
await run("exit7", [exe, "-e", "console.error('x'); process.exit(7)"]);
await run("enoent", ["/nonexistent/bin/bun", "--lint"]);
await run("stdin-ignored", [exe, "-e", "console.log(require('fs').readFileSync(0).length)"]);
