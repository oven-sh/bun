// Flags: --aot-testing=CheckWalkAtRunTime
// The twin of quiet-streams-and-a-pipeline.mjs in a build that holds node:http. There the library lays accessors named `aborted` and `signal` on the prototype of its
// own IncomingMessage and a method named `abort` on that of its ClientRequest, and the compiler no longer proves at the build that nobody writes the members of those names
// on AbortSignal.prototype and AbortController.prototype. It asks them when the program runs. As long as it left two of the questions as written, every pipeline beside
// node:http made and aborted a controller: right in every answer, 13% of a streamed response, and seen by no test.
// The first pipeline makes the two classes, and hears no until then.
// COUNTER: LibraryFastPathChecksPassed >= 22800
// STATISTIC: MemberLookupChecksLeftGeneric <= 0
import http from "node:http";
import { pipeline, Readable, Writable } from "node:stream";

let bytes = 0;
for (let turn = 0; turn < 200; turn++) {
  await new Promise((resolve, reject) => {
    let left = 3;
    const source = new Readable({
      read() {
        this.push(left-- > 0 ? "made up " + turn : null);
      },
    });
    const sink = new Writable({
      write(chunk, encoding, callback) {
        bytes += chunk.length;
        callback();
      },
    });
    pipeline(source, sink, error => (error ? reject(error) : resolve()));
  });
}
console.log(bytes, typeof http.IncomingMessage, typeof http.ClientRequest);
