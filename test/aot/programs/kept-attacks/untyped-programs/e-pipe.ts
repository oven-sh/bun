// Untyped programs: e pipe. It prints what plain Bun prints.
import { Readable, Writable } from "node:stream";
let bytes = 0;
const sink = new Writable({
  write(chunk, _encoding, done) {
    bytes += chunk.length;
    done();
  },
});
sink.on("finish", () => console.log(bytes));
Readable.from([Buffer.from("ab"), Buffer.from("cde")]).pipe(sink);
