// N sequential spawns of `true` with default stdio. MODE: none (nothing reads), out (a 'data' listener on stdout), both.
const { spawn } = require("node:child_process");
const N = +process.env.N || 50, mode = process.env.MODE || "none";
let i = 0;
(function next() {
  if (i++ === N) return;
  const c = spawn("true");
  if (mode !== "none") c.stdout.on("data", () => {});
  if (mode === "both") c.stderr.on("data", () => {});
  c.on("close", next);
})();
