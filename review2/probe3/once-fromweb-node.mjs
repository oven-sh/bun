import { once } from "node:events";
import { Readable } from "node:stream";
import { openAsBlob } from "node:fs";
const SIZE = 3_000_000;
const s = Readable.fromWeb((await openAsBlob("/tmp/probe3/zeros.bin")).stream());
let bytes = 0, ended = false;
s.on("end", () => (ended = true));
const closed = once(s, "close");
while (!ended) {
  const r = await Promise.race([once(s, "data"), closed.then(() => null)]);
  if (r === null) break;
  bytes += r[0].length;
}
console.log(JSON.stringify({ which: "fromWeb(blob.stream())", runtime: typeof Bun === "undefined" ? "node " + process.version : "bun " + Bun.version + "+" + Bun.revision.slice(0, 9), lost: SIZE - bytes }));
process.exit(0);
