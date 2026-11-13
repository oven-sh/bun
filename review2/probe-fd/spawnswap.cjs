// N sequential spawns of `true`. MODE=native: stdout+stderr are pipes (NativeReadable). MODE=sock: stdout+stderr ignored, fd 3 and 4 are pipes (fd-backed net.Socket). Same number of socketpairs either way.
// LISTEN=1 adds a 'data' listener to both streams. PRELOAD=1 requires node:net up front in both modes.
const { spawn } = require("node:child_process");
if (process.env.PRELOAD) require("node:net");
const N = +process.env.N || 50, mode = process.env.MODE || "native", listen = !!process.env.LISTEN;
const stdio = mode === "native" ? ["ignore", "pipe", "pipe"] : ["ignore", "ignore", "ignore", "pipe", "pipe"];
let i = 0;
(function next() {
  if (i++ === N) return;
  const c = spawn("true", [], { stdio });
  const a = mode === "native" ? c.stdout : c.stdio[3], b = mode === "native" ? c.stderr : c.stdio[4];
  if (listen) { a.on("data", () => {}); b.on("data", () => {}); }
  let left = mode === "native" ? 1 : 3;
  const done = () => { if (--left === 0) next(); };
  c.on("close", done);
  if (mode !== "native") { a.on("close", done); b.on("close", done); if (!listen) { c.on("exit", () => { a.resume(); b.resume(); }); } }
})();
