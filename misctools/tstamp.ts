// timestamps of restore milestones: spawn -> first "[image] restored" stderr line -> prompt visible
const cli = process.argv[2]; const t0 = performance.now(); let tRestored = 0, tPrompt = 0; let buf = "";
const proc = Bun.spawn([cli], { env: { ...process.env, TERM: "xterm-256color", BUN_IMAGE_VERBOSE: "0" }, terminal: { cols: 120, rows: 40, data(_t, d) { const s = new TextDecoder().decode(d); buf += s; if (!tRestored && buf.includes("[image] restored")) tRestored = performance.now() - t0; if (!tPrompt && buf.includes("❯")) tPrompt = performance.now() - t0; } } });
while (!tPrompt && performance.now() - t0 < 20000) await Bun.sleep(2);
proc.kill("SIGKILL"); await proc.exited;
console.log(`restored-line at ${tRestored.toFixed(0)} ms, prompt at ${tPrompt.toFixed(0)} ms`);
