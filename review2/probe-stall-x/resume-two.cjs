// The PR's test "a 'data' listener that throws on the chunk resume() hands over does not stop the stream"
// (test/js/node/child_process/child_process.test.ts:2504), with one change: TWO chunks wait in the stream when it is
// resumed (argv[2] = "two"), and the child is done by then. With argv[2] = "one" it is the test's own case.
const { spawn } = require("node:child_process");
const two = process.argv[2] === "two";
const writer = `let k = 0; process.stdin.on("data", () => { require("fs").writeSync(1, String(++k)); if (k === 3) process.exit(0); });`;
const child = spawn(process.execPath, ["-e", writer], { stdio: ["pipe", "pipe", "inherit"] });
const out = child.stdout;
const seen = [];
const deadline = Date.now() + 5000;
process.on("uncaughtException", (e, origin) => {
  seen.push(origin + ":" + e.message);
  if (!two) child.stdin.write("go\n"); // the test: chunk 3 is written after the throw was reported
});
out.once("resume", () => child.stdin.write("go\n"));
out.on("data", chunk => {
  seen.push("data " + chunk);
  if (String(chunk) === "1") {
    out.pause();
    child.stdin.write("go\n");
    setImmediate(function wait() {
      if (two && out.readableLength === 1 && !wait.sent) { wait.sent = true; child.stdin.write("go\n"); }
      const ready = two ? out.readableLength === 2 && out._readableState.ended : out.readableLength > 0;
      if (!ready && Date.now() < deadline) return setImmediate(wait);
      seen.push("buffered " + out.readableLength);
      out.resume();
    });
  } else if (String(chunk) === "2") {
    throw new Error("data-throw");
  }
});
out.on("end", () => seen.push("end"));
child.on("close", code => seen.push("close " + code));
setTimeout(() => { console.log(seen.join(", ")); process.exit(0); }, 2500);
