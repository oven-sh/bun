// keystroke -> echo latency, restored vs normal boot (after each is idle at the prompt)
const cli = process.argv[2]; const mode = process.argv[3]; // "restored" | "normal"
let buf = ""; const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
const proc = Bun.spawn([cli], {
  env: { ...process.env, TERM: "xterm-256color", ...(mode === "normal" ? { BUN_IMAGE: "0", BUN_JSC_useBaselineJIT: "0", BUN_JSC_useFTLJIT: "0" } : {}) },
  terminal: { cols: 150, rows: 45, data(_t, d) { buf += new TextDecoder().decode(d); } },
});
const until = async (p: () => boolean, ms: number) => { const t = performance.now(); while (performance.now() - t < ms) { if (p()) return true; await Bun.sleep(1); } return false; };
await until(() => buf.includes("❯"), 30000); await Bun.sleep(mode === "normal" ? 4000 : 1500); // let it settle
const lats: number[] = []; const order: number[] = [];
const word = "hellotherehowareyoudoing";
for (const ch of word) {
  const before = strip(buf).length; const t0 = performance.now();
  proc.terminal!.write(ch);
  await until(() => { const s = strip(buf); return s.length > before && s.slice(before).includes(ch); }, 2000);
  const l = performance.now() - t0; lats.push(l); order.push(l); await Bun.sleep(30);
}
proc.kill("SIGKILL"); await proc.exited;
lats.sort((a, b) => a - b); const p = (q: number) => lats[Math.min(lats.length - 1, Math.floor(q * lats.length))].toFixed(1);
console.log(`${mode}: keystrokes=${lats.length} first3=${order.slice(0,3).map(x=>x.toFixed(1)).join("/")}ms p50=${p(0.5)}ms p90=${p(0.9)}ms max=${lats[lats.length - 1].toFixed(1)}ms`);
