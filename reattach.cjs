// A 'data' listener that removes itself and comes back from a promise job. The writer sends block k+1 only after the
// parent is inside the listener for block k, and the listener returns only when block k+1 is in the pipe.
// Marker files pace both sides. Expected (Node, main): a1024 b1024 c1024 d1024 e1024 f1024
const fs = require("fs"), os = require("os"), path = require("path");
const BLOCKS = 6, nap = new Int32Array(new SharedArrayBuffer(4));
const waitFor = file => { const end = Date.now() + 8000; while (!fs.existsSync(file)) { if (Date.now() > end) return false; Atomics.wait(nap, 0, 0, 1); } return true; };
if (process.argv[2] === "writer") {
  const dir = process.argv[3];
  for (let k = 0; k < BLOCKS; k++) {
    if (k > 0 && !waitFor(dir + "/seen" + (k - 1))) process.exit(3);
    fs.writeSync(1, Buffer.alloc(1024, 97 + k));
    fs.writeFileSync(dir + "/written" + k, "");
  }
  return;
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reattach-"));
const out = require("node:child_process").spawn(process.execPath, [__filename, "writer", dir], { stdio: ["ignore", "pipe", "inherit"] }).stdout;
const got = [];
const report = note => { console.log(Buffer.concat(got).toString("latin1").replace(/(.)\1*/g, run => run[0] + run.length + " ").trim() + note); fs.rmSync(dir, { recursive: true, force: true }); };
function onData(chunk) {
  got.push(Buffer.from(chunk));
  const k = chunk[chunk.length - 1] - 97;
  fs.writeFileSync(dir + "/seen" + k, "");
  if (k + 1 < BLOCKS) waitFor(dir + "/written" + (k + 1));
  out.removeListener("data", onData);
  Promise.resolve().then(() => out.on("data", onData));
}
out.on("data", onData);
out.on("end", () => { clearTimeout(guard); report(""); });
const guard = setTimeout(() => { report("  <== no 'end' after 6 s"); process.exit(2); }, 6000);
