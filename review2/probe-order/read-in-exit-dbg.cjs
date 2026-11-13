const { spawn } = require("node:child_process");
const name = process.argv[2] || "stdout";
const childBin = process.argv[3] || process.execPath;
const env = {};
for (const k in process.env) if (!k.startsWith("BUN_DEBUG_")) env[k] = process.env[k];
env.BUN_DEBUG_QUIET_LOGS = "1";
const c = spawn(childBin, ["-e", `process.${name}.write(Buffer.alloc(3000, "o"));`], { stdio: ["ignore", "pipe", "pipe"], env });
let read;
c.on("exit", () => {
  process._rawDebug?.("JS: 'exit' listener");
  const chunk = c[name].read();
  read = chunk === null ? null : chunk.length;
});
c.on("close", code => console.log(JSON.stringify({ read, code })));
