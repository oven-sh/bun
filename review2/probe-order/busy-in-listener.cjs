// The arm-before-call case: the child writes its last chunk and exits while the 'data' listener of the chunk before runs.
const { spawn } = require("node:child_process");
const order = [];
const writer = `const fs = require("fs"); fs.writeSync(1, "1"); const nap = new Int32Array(new SharedArrayBuffer(4)); Atomics.wait(nap, 0, 0, 100); fs.writeSync(1, "2");`;
const child = spawn(process.execPath, ["-e", writer], { stdio: ["ignore", "pipe", "inherit"] });
child.stdout.on("data", d => {
  order.push("data " + d);
  if (String(d) === "1") { const end = Date.now() + 400; while (Date.now() < end); }
});
child.stdout.on("end", () => order.push("end"));
child.on("exit", () => order.push("exit"));
child.on("close", () => console.log(order.join(", ")));
