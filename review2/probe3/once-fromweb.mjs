// The same one-at-a-time consumer over Readable.fromWeb(Bun.spawn().stdout) and over process.stdin (both stay on the pull path in the PR).
import { once } from "node:events";
import { Readable } from "node:stream";
const SIZE = 3_000_000, which = process.argv[2];
let s;
if (which === "fromweb") s = Readable.fromWeb(Bun.spawn(["head", "-c", String(SIZE), "/dev/zero"], { stdout: "pipe" }).stdout);
else if (which === "file") s = Readable.fromWeb(Bun.file("/tmp/probe3/zeros.bin").stream());
else s = process.stdin;
let bytes = 0, ended = false;
s.on("end", () => (ended = true));
const closed = once(s, "close");
while (!ended) {
  const r = await Promise.race([once(s, "data"), closed.then(() => null)]);
  if (r === null) break;
  bytes += r[0].length;
}
console.log(JSON.stringify({ which, lost: SIZE - bytes }));
process.exit(0);
