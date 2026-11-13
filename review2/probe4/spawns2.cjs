// N sequential spawns of `true`. ROUTE=std: stdout/stderr are "pipe" (NativeReadable). ROUTE=fd: two extra "pipe" slots (net.Socket over the fd) instead.
// MODE: none (nothing reads) | both ('data' listeners on both streams).
const { spawn } = require("node:child_process");
const N = +process.env.N || 50, mode = process.env.MODE || "none", route = process.env.ROUTE || "std";
let i = 0;
(function next() {
  if (i++ === N) return;
  const c = spawn("true", [], { stdio: route === "std" ? ["ignore", "pipe", "pipe"] : ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const a = route === "std" ? c.stdout : c.stdio[3], b = route === "std" ? c.stderr : c.stdio[4];
  if (mode === "both") { a.on("data", () => {}); b.on("data", () => {}); }
  c.on("close", next);
})();
