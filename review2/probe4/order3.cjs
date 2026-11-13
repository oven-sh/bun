// Port of "a listener that removes itself and comes back from a promise job misses no chunk". argv[2]: fd | std
const mode = process.argv[2];
const BLOCKS = 6;
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "order3-"));
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
  for (let k = 0; k < ${BLOCKS}; k++) {
    if (k > 0) waitFor("seen" + (k - 1));
    fs.writeSync(1, Buffer.alloc(1024, 97 + k));
    fs.writeFileSync(path.join(__dirname, "written" + k), "");
  }
`);
const nap = new Int32Array(new SharedArrayBuffer(4));
const deadline = Date.now() + 15_000;
function waitFor(name) { while (!fs.existsSync(path.join(dir, name))) { if (Date.now() > deadline) throw new Error("timed out waiting for " + name); Atomics.wait(nap, 0, 0, 1); } }
const child = mode === "fd"
  ? require("./fdroute.cjs").spawnFd(process.execPath, [path.join(dir, "writer.js")])
  : require("node:child_process").spawn(process.execPath, [path.join(dir, "writer.js")], { stdio: ["ignore", "pipe", "inherit"] });
const out = child.stdout;
const got = [];
let end = 0;
function onData(chunk) {
  got.push(chunk);
  const k = chunk[chunk.length - 1] - 97;
  fs.writeFileSync(path.join(dir, "seen" + k), "");
  if (k + 1 < BLOCKS) waitFor("written" + (k + 1));
  out.removeListener("data", onData);
  Promise.resolve().then(() => out.on("data", onData));
}
out.on("data", onData);
out.on("end", () => end++);
process.on("exit", () => {
  const runs = Buffer.concat(got).toString("latin1").replace(/(.)\1*/g, run => run[0] + run.length + " ").trim();
  console.log(runs + " end=" + end);
  fs.rmSync(dir, { recursive: true, force: true });
});
