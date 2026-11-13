const { spawn, execSync, spawnSync } = require("node:child_process");
const child = spawn("sh", ["-c", "printf 1; sleep 0.1; printf 2; sleep 0.1; printf 3"], { stdio: ["ignore", "pipe", "inherit"] });
const order = [];
let n = 0;
child.stdout.on("data", d => {
  const k = ++n;
  order.push("in" + k + "=" + d);
  const out = execSync("sleep 0.3; head -c 300000 /dev/zero | wc -c").toString().trim();
  order.push("sync=" + out);
  Promise.resolve().then(() => order.push("j" + k));
  process.nextTick(() => order.push("t" + k));
  order.push("out" + k);
});
child.stdout.on("end", () => order.push("end"));
child.on("exit", code => order.push("exit"));
child.on("close", code => console.log(order.join(" ") + " close=" + code));
