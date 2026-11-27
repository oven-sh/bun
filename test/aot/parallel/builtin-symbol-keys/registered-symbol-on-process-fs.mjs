// graceful-fs and others keep their state under registered symbols on process and on the exports of node:fs.
import fs from "node:fs";
const queue = Symbol.for("made.up.queue");
console.log(process[queue], fs[queue]);
Object.defineProperty(fs, queue, { get: () => "from fs" });
process[queue] = "from process";
console.log(process[queue], fs[queue]);
