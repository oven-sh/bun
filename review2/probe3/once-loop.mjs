// A common consumer: `await once(stream, "data")` in a loop. Does it see every byte?
import { spawn } from "node:child_process";
import { once } from "node:events";
const SIZE = 3_000_000;
const mode = process.argv[2] || "gapless";
const c = mode === "gapless"
  ? spawn("head", ["-c", String(SIZE), "/dev/zero"], { stdio: ["ignore", "pipe", "ignore"] })
  : spawn("sh", ["-c", "for i in 1 2 3 4 5 6 7 8; do printf chunk$i; sleep 0.03; done"], { stdio: ["ignore", "pipe", "ignore"] });
let bytes = 0, rounds = 0, ended = false;
c.stdout.on("end", () => (ended = true));
const closed = once(c, "close");
while (!ended) {
  const r = await Promise.race([once(c.stdout, "data"), closed.then(() => null)]);
  if (r === null) break;
  bytes += r[0].length; rounds++;
}
const expected = mode === "gapless" ? SIZE : 48;
console.log(JSON.stringify({ mode, bytes, lost: expected - bytes, rounds }));
process.exit(0);
