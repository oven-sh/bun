// Client CPU per fetch() against response-headers-server.mjs.
//   bun bench/fetch/response-headers.mjs <port> [small|nginx|cookies] [body|get|iter] [requests] [concurrency]
// mode: body = read the body only; get = also headers.get(); iter = also iterate all headers.
// Reports requests/s and this process's CPU time per request (user+sys across
// all threads), which is the number to compare between builds when the server
// is the throughput bottleneck.
const [port, kind = "nginx", mode = "body", total = 200000, conc = 64] = process.argv.slice(2);
const url = `http://127.0.0.1:${port}/${kind}`;
const N = Number(total),
  C = Number(conc);
let sink = 0;
async function one() {
  const r = await fetch(url);
  if (mode === "get") sink += r.headers.get("content-type").length;
  else if (mode === "iter") for (const [k, v] of r.headers) sink += k.length + v.length;
  const b = await r.arrayBuffer();
  sink += b.byteLength;
}
// warmup
await Promise.all(Array.from({ length: C }, one));
const cpu0 = process.cpuUsage();
const t0 = performance.now();
let started = 0;
async function worker() {
  while (started < N) {
    started++;
    await one();
  }
}
await Promise.all(Array.from({ length: C }, worker));
const t = performance.now() - t0;
const cpu = process.cpuUsage(cpu0);
const cpuMs = (cpu.user + cpu.system) / 1000;
console.log(
  JSON.stringify({
    kind,
    mode,
    N,
    C,
    ms: +t.toFixed(0),
    rps: Math.round(N / (t / 1000)),
    cpu_us_per_req: +((cpuMs * 1000) / N).toFixed(2),
    user_ms: Math.round(cpu.user / 1000),
    sys_ms: Math.round(cpu.system / 1000),
    sink,
  }),
);
