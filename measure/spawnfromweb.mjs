import { Readable } from "node:stream";
const proc = Bun.spawn({ cmd: ["head", "-c", "1073741824", "/dev/zero"], stdout: "pipe" });
let n = 0, bytes = 0;
Readable.fromWeb(proc.stdout).on("data", c => { n++; bytes += c.length; }).on("end", () => console.log(JSON.stringify({ n, bytes })));
