// a child that makes 300k tiny writes; the parent counts chunks. Reports wall/user/sys.
const { spawn } = require("node:child_process");
const t0 = process.hrtime.bigint();
const how = process.env.HOW || "data";
const child = spawn("/tmp/rel/bun-arm", ["-e", `const fs=require("fs");const b=Buffer.from("0123456789abcdef\\n");for(let i=0;i<300000;i++)fs.writeSync(1,b);`], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0, bytes = 0;
function done() {
  const ru = process.resourceUsage();
  console.log(JSON.stringify({ how, n, bytes, wall_ms: Number((process.hrtime.bigint() - t0) / 1000000n), user_ms: Math.round(ru.userCPUTime / 1000), sys_ms: Math.round(ru.systemCPUTime / 1000), maxrss_mb: Math.round(ru.maxRSS / 1024) }));
}
if (how === "data") { child.stdout.on("data", c => { n++; bytes += c.length; }); child.on("close", done); }
else if (how === "utf8") { child.stdout.setEncoding("utf8"); child.stdout.on("data", c => { n++; bytes += c.length; }); child.on("close", done); }
else if (how === "forawait") { (async () => { for await (const c of child.stdout) { n++; bytes += c.length; } done(); })(); }
else if (how === "readline") { const rl = require("node:readline").createInterface({ input: child.stdout }); rl.on("line", l => { n++; bytes += l.length + 1; }); rl.on("close", done); }
