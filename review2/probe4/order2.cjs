// Port of "a chunk and the EOF that are already in the pipe wait for the listener's tick and promise job". argv[2]: fd | std
const mode = process.argv[2];
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "order2-"));
const waitForSrc = `
  const nap = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + 15_000;
  function waitFor(name) {
    while (!fs.existsSync(path.join(__dirname, name))) {
      if (Date.now() > deadline) throw new Error("timed out waiting for " + name);
      Atomics.wait(nap, 0, 0, 1);
    }
  }`;
fs.writeFileSync(path.join(dir, "writer.js"), `
  const fs = require("node:fs"); const path = require("node:path");
  ${waitForSrc}
  waitFor("go1"); fs.writeSync(1, "1"); waitFor("go2"); fs.writeSync(1, "2"); fs.closeSync(1);
  fs.writeFileSync(path.join(__dirname, "written2"), "");
`);
const nap = new Int32Array(new SharedArrayBuffer(4));
const deadline = Date.now() + 15_000;
function waitFor(name) { while (!fs.existsSync(path.join(dir, name))) { if (Date.now() > deadline) throw new Error("timed out waiting for " + name); Atomics.wait(nap, 0, 0, 1); } }
const child = mode === "fd"
  ? require("./fdroute.cjs").spawnFd(process.execPath, [path.join(dir, "writer.js")])
  : require("node:child_process").spawn(process.execPath, [path.join(dir, "writer.js")], { stdio: ["ignore", "pipe", "inherit"] });
const order = [];
let n = 0;
child.stdout.once("resume", () => fs.writeFileSync(path.join(dir, "go1"), ""));
child.stdout.on("data", chunk => {
  const k = ++n;
  order.push("d" + k + "=" + chunk);
  process.nextTick(() => order.push("t" + k));
  Promise.resolve().then(() => order.push("j" + k));
  if (k === 1) { fs.writeFileSync(path.join(dir, "go2"), ""); waitFor("written2"); }
});
child.stdout.on("end", () => order.push("end"));
child.on("close", code => { console.log(order.join(" ") + " close=" + code); fs.rmSync(dir, { recursive: true, force: true }); });
