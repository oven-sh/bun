// What fs.promises.readFile answers is a Buffer that native code makes, and Buffer.prototype.toJSON is written in JavaScript. This program never names Buffer.
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
const path = `${tmpdir()}/buffer-to-json-${process.pid}.txt`;
await Bun.write(path, "ab");
console.log((await readFile(path)).toJSON());
await Bun.file(path).delete();
