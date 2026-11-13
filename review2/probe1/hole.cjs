// No 'uncaughtException' handler. A consumer that starts in 'readable' mode and switches to a throwing 'data' listener
// from inside a 'readable' event, while the child writes without gaps.
const { spawn } = require("node:child_process");
const c = spawn("sh", ["-c", "head -c 16777216 /dev/zero"], { stdio: ["ignore", "pipe", "ignore"] });
const out = c.stdout;
let phase = 0, calls = 0; const seen = [];
function onReadable() {
  if (phase === 0) return;            // let the buffer fill: the reader stops
  if (phase === 1) {
    phase = 2;
    while (out.read() !== null);      // drain: _read() asks the reader to start again
    out.removeListener("readable", onReadable);
    out.on("data", () => { calls++; throw new Error("data-throw-fatal"); });
  }
}
out.on("readable", onReadable);
out.on("end", () => seen.push("end"));
c.on("close", code => { seen.push("close " + code); });
setTimeout(() => { phase = 1; while (out.read() !== null); }, 300); // drain from a timer: the next reads come from the read-start task
process.on("exit", code => console.log(JSON.stringify({ code, calls, seen })));
