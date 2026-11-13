// Parent: logs when 'data' and 'exit' arrive. Child: writes, then stays alive for DELAY ms.
const { spawn } = require("node:child_process");
const delay = process.argv[2] || "0";
const t0 = process.hrtime.bigint();
const us = () => Number((process.hrtime.bigint() - t0) / 1000n);
const c = spawn(process.execPath, ["-e", `process.stdout.write(Buffer.alloc(3000, "o")); if (${delay} > 0) setTimeout(() => {}, ${delay});`], { stdio: ["ignore", "pipe", "pipe"] });
const ev = [];
c.stdout.on("data", d => ev.push(["data", d.length, us()]));
c.stdout.on("end", () => ev.push(["end", us()]));
c.on("exit", () => ev.push(["exit", us()]));
c.on("close", () => console.log(JSON.stringify(ev)));
