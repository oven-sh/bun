const { spawn } = require("node:child_process");
const N = +process.env.N || 2000, route = process.env.ROUTE || "std", mode = process.env.MODE || "both";
let i = 0; const t0 = process.hrtime.bigint();
(function next() {
  if (i++ === N) { const ns = Number(process.hrtime.bigint() - t0); console.log(JSON.stringify({ route, mode, us_per_spawn: +(ns / N / 1000).toFixed(1) })); return; }
  const c = spawn("true", [], { stdio: route === "std" ? ["ignore", "pipe", "pipe"] : ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const a = route === "std" ? c.stdout : c.stdio[3], b = route === "std" ? c.stderr : c.stdio[4];
  if (mode === "both") { a.on("data", () => {}); b.on("data", () => {}); }
  c.on("close", next);
})();
