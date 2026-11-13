// Port of "a listener's tick runs before its promise job" (child_process.test.ts). argv[2]: fd | std
const mode = process.argv[2];
const writer = `let k = 0; process.stdin.on("data", () => require("fs").writeSync(1, String(++k)));`;
const child = mode === "fd"
  ? require("./fdroute.cjs").spawnFd(process.execPath, ["-e", writer], { stdin: "pipe" })
  : require("node:child_process").spawn(process.execPath, ["-e", writer], { stdio: ["pipe", "pipe", "inherit"] });
const order = [];
let n = 0;
child.stdout.once("resume", () => child.stdin.write("go\n"));
child.stdout.on("data", chunk => {
  const k = ++n;
  order.push("d" + k + "=" + chunk);
  let left = 2;
  const done = () => { if (--left > 0) return; if (k < 3) child.stdin.write("go\n"); else child.stdin.end(); };
  process.nextTick(() => { order.push("t" + k); done(); });
  Promise.resolve().then(() => { order.push("j" + k); done(); });
});
child.stdout.on("end", () => order.push("end"));
child.on("close", code => console.log(order.join(" ") + " close=" + code));
