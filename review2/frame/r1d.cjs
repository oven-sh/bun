const { spawn } = require("node:child_process");
const c = spawn("sh", ["-c", "printf hi"]);
let n = 0;
c.on("exit", () => {
  console.log("exit");
  c.stdout.on("data", () => { n++; console.log("data", n); throw new Error("boom"); });
  c.stdout.on("end", () => console.log("end"));
});
c.on("close", code => { console.log("child close", code); process.exit(code); });
