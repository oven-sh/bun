import { spawn } from "node:child_process";
import { once } from "node:events";
const SIZE = 3_000_000;
const c = spawn("sh", ["-c", `head -c ${SIZE} /dev/zero >&3`], { stdio: ["ignore", "ignore", "ignore", "pipe"] });
const s = c.stdio[3];
let bytes = 0, rounds = 0, ended = false;
s.on("end", () => (ended = true));
const closed = once(s, "close");
while (!ended) {
  const r = await Promise.race([once(s, "data"), closed.then(() => null)]);
  if (r === null) break;
  bytes += r[0].length; rounds++;
}
console.log(JSON.stringify({ via: "stdio[3]", bytes, lost: SIZE - bytes, rounds }));
process.exit(0);
