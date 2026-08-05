// Bun.Terminal-based driver for a restored/normal CC: real pty, exit code + signal, footprint sampling, scripted keystrokes.
// usage: bun drive.ts <cli> [--img /tmp/x.img] [--type "text"] [--enter] [--wait "⏺"] [--secs N] [--env K=V ...] [--log /tmp/out.log]
const args = process.argv.slice(2);
const cli = args[0];
const opt = (k: string, d?: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k: string) => args.includes(k);
const envs: Record<string, string> = {};
args.forEach((a, i) => { if (a === "--env") { const [k, ...v] = args[i + 1].split("="); envs[k] = v.join("="); } });
const img = opt("--img");
const secs = +(opt("--secs", "40")!);
const logPath = opt("--log", "/tmp/drive.log")!;
const out: string[] = [];
let buf = "";
const env = {
  ...process.env, TERM: "xterm-256color",
  BUN_JSC_useGenerationalGC: "0", MIMALLOC_DETERMINISTIC_HINT: "1", BUN_IMAGE_JIT_ADDR: "0x3c0000000",
  BUN_JSC_useConcurrentGC: "0", BUN_JSC_useConcurrentJIT: "0", BUN_MEMDEBUG: process.cwd(),
  ...(img ? { BUN_IMAGE_IN: img } : {}), ...envs,
};
const pre = has("--setsid") ? ["/usr/bin/perl", "-e", "use POSIX; POSIX::setsid(); exec @ARGV", "--"] : [];
const proc = Bun.spawn([...pre, `${process.env.HOME}/code/tmp/noaslr/noaslr`, cli], {
  env, cwd: process.cwd(),
  terminal: { cols: 150, rows: 45, data: (_t, d) => { const s = new TextDecoder().decode(d); buf += s; out.push(s); } },
});
const footprint = () => { try { const r = Bun.spawnSync(["vmmap", "--summary", String(proc.pid)]); const m = /Physical footprint:\s+(\S+)/.exec(r.stdout.toString()); return m ? m[1] : "?"; } catch { return "?"; } };
const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
const waitFor = async (re: RegExp, ms: number) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(strip(buf))) return true; if (proc.exitCode !== null || proc.signalCode) return false; await Bun.sleep(200); } return false; };
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
console.log(`[drive] pid=${proc.pid} img=${img ?? "-"}`);
await Bun.sleep(1000);
if (proc.exitCode !== null || proc.signalCode) { console.log(`[drive] DIED at ${stamp()}: exit=${proc.exitCode} signal=${proc.signalCode}`); }
else {
  const ready = await waitFor(/❯|>/, 20000);
  console.log(`[drive] ${stamp()} prompt=${ready} footprint=${footprint()}`);
  await Bun.sleep(12000);
  console.log(`[drive] ${stamp()} idle footprint=${footprint()}`);
  const text = opt("--type");
  if (text) {
    proc.terminal!.write(text); await Bun.sleep(1500);
    if (has("--enter")) { proc.terminal!.write("\r"); }
    const w = opt("--wait");
    if (w) { const ok = await waitFor(new RegExp(w), secs * 1000); console.log(`[drive] ${stamp()} waited for ${w}: ${ok} footprint=${footprint()}`); }
    await Bun.sleep(8000);
    console.log(`[drive] ${stamp()} after interaction footprint=${footprint()}`);
  }
}
if (proc.exitCode === null && !proc.signalCode) { proc.kill("SIGTERM"); await Bun.sleep(500); proc.kill("SIGKILL"); }
const code = await proc.exited;
console.log(`[drive] exited code=${code} signal=${proc.signalCode} at ${stamp()}`);
await Bun.write(logPath, strip(buf));
const tail = strip(buf).split("\n").filter(l => l.trim()).slice(-8).join("\n");
console.log("[drive] last screen lines:\n" + tail.slice(0, 1200));
