// time to first prompt (❯ visible) + time until typed char echoes, restored vs normal
const cli = process.argv[2], img = process.argv[3];
async function run(useImg: boolean) {
  let buf = ""; const t0 = performance.now(); let tPrompt = 0, tEcho = 0;
  const proc = Bun.spawn([cli], {
    env: { ...process.env, TERM: "xterm-256color", MIMALLOC_DETERMINISTIC_HINT: "1", BUN_IMAGE_JIT_ADDR: "0x3c0000000", BUN_JSC_useBaselineJIT: "0", BUN_JSC_useFTLJIT: "0", ...(useImg ? { BUN_IMAGE_IN: img } : {}) },
    terminal: { cols: 150, rows: 45, data(_t, d) { buf += new TextDecoder().decode(d); } },
  });
  while (performance.now() - t0 < 30000) { if (!tPrompt && buf.includes("❯")) { tPrompt = performance.now() - t0; proc.terminal!.write("q"); } if (tPrompt && !tEcho && /❯[^\n]*q/.test(buf.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, ""))) { tEcho = performance.now() - t0; break; } await Bun.sleep(5); }
  const cpu = Bun.spawnSync(["ps", "-o", "time=", "-p", String(proc.pid)]).stdout.toString().trim();
  proc.kill("SIGKILL"); await proc.exited;
  return { tPrompt: tPrompt | 0, tEcho: tEcho | 0, cpu };
}
for (const useImg of [false, true, false, true]) console.log(useImg ? "restored" : "normal  ", JSON.stringify(await run(useImg)));
