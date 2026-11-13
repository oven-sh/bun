const { spawn } = require("node:child_process");
const name = process.argv[2] || "stdout";
const stdio = JSON.parse(process.argv[3] || '["ignore","pipe","pipe"]');
const t0 = process.hrtime.bigint();
const us = () => Number((process.hrtime.bigint() - t0) / 1000n);
const c = spawn(process.execPath, ["-e", `process.${name}.write(Buffer.alloc(3000, "o"));`], { stdio });
let read, tExit, later = [];
c.on("exit", () => {
  tExit = us();
  const chunk = c[name].read();
  read = chunk === null ? null : chunk.length;
  c[name].on("data", d => later.push(["data", d.length, us() - tExit]));
  c[name].on("end", () => later.push(["end", us() - tExit]));
});
c.on("close", code => console.log(JSON.stringify({ read, code, tExit, later })));
