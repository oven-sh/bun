// The parent is busy (not in its poll) while the child writes and exits. WHERE says what is busy.
const { spawn } = require("node:child_process");
const where = process.argv[2] || "timer";
const name = process.argv[3] || "stdout";
const BUSY = 400;
const busy = () => { const end = Date.now() + BUSY; while (Date.now() < end); };
const c = spawn(process.execPath, ["-e", `process.${name}.write(Buffer.alloc(3000, "o"));`], { stdio: ["ignore", "pipe", "pipe"] });
let read, order = [];
if (where === "timer") setTimeout(busy, 1);
else if (where === "immediate") setImmediate(() => setImmediate(busy));
else if (where === "fs") require("fs").readFile(__filename, busy);
else if (where === "sync") busy();
else if (where === "none") {}
c.on("exit", () => {
  const chunk = c[name].read();
  read = chunk === null ? null : chunk.length;
});
c.on("close", code => console.log(JSON.stringify({ where, read, code })));
