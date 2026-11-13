// child.stdin: a write callback / 'drain' listener that throws. Which channel reports it, and does the stream go on?
const { spawn } = require("node:child_process");
const mode = process.argv[2];
process.on("uncaughtException", (e, origin) => console.log("uncaughtException:", e.message, "origin=" + origin));
process.on("unhandledRejection", e => console.log("unhandledRejection:", e && e.message));
const c = spawn("sh", ["-c", "sleep 0.3; cat > /dev/null"], { stdio: ["pipe", "ignore", "ignore"] });
const big = Buffer.alloc(1 << 20, 97);
let drains = 0, cbs = 0;
if (mode === "drain") {
  c.stdin.on("drain", () => { drains++; if (drains === 1) throw new Error("drain-throw"); });
  (function w() { for (let i = 0; i < 8; i++) c.stdin.write(big); })();
  setTimeout(() => { c.stdin.write(big); c.stdin.end(); }, 600);
} else {
  c.stdin.write(big, () => { cbs++; throw new Error("write-cb-throw"); });
  c.stdin.write(big, () => { cbs++; });
  c.stdin.end();
}
c.stdin.on("finish", () => console.log("finish"));
c.stdin.on("close", () => console.log("stdin close"));
c.on("close", code => console.log("child close", code, "drains=" + drains, "cbs=" + cbs));
setTimeout(() => { console.log("timeout: drains=" + drains + " cbs=" + cbs); process.exit(0); }, 4000).unref();
