const { spawnFd } = require("./fdroute.cjs");
const mode = process.argv[2];
const t0 = Date.now();
const c = spawnFd("sleep", ["2"], { lazyRef: true });
c.unref();
if (mode === "touch") { void c.stdout; void c.stderr; }
if (mode === "data") c.stdout.on("data", () => {});
if (mode === "readable") c.stdout.on("readable", () => {});
process.on("exit", () => console.log("facade lazyRef", mode, "lived", ((Date.now() - t0) / 1000).toFixed(1), "s"));
