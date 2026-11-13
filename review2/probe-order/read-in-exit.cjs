const { spawn } = require("node:child_process");
const name = process.argv[2] || "stdout";
const stdio = JSON.parse(process.argv[3] || '["ignore","pipe","pipe"]');
const c = spawn(process.execPath, ["-e", `process.${name}.write(Buffer.alloc(3000, "o"));`], { stdio });
let read;
c.on("exit", () => {
  const chunk = c[name].read();
  read = chunk === null ? null : chunk.length;
});
c.on("close", code => console.log(JSON.stringify({ read, code })));
