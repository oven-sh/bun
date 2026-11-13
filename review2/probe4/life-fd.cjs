// /tmp/frame/life.cjs for the fd route: an unref'd `sleep 2` child that holds an extra "pipe" slot (a net.Socket over the fd).
const { spawn } = require("node:child_process");
const mode = process.argv[2];
const t0 = Date.now();
const c = mode.startsWith("std")
  ? spawn("sleep", ["2"], { stdio: ["ignore", "pipe", "pipe"] })
  : spawn("sleep", ["2"], { stdio: ["ignore", "ignore", "ignore", "pipe"] });
c.unref();
const s = mode.startsWith("std") ? c.stdout : c.stdio[3];
if (mode.endsWith("data")) s.on("data", () => {});
if (mode.endsWith("unref")) { s.unref(); }
if (mode.endsWith("unrefdata")) { s.unref(); s.on("data", () => {}); }
process.on("exit", () => console.log(mode, "lived", ((Date.now() - t0) / 1000).toFixed(1), "s"));
