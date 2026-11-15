// A program lays a getter of its own under AbortController.prototype.signal that answers undefined, then null, then a made-up object.
// A stage of a pipeline is handed what that getter answered, and the getter is asked once a pipeline.
import { pipeline, Readable, Writable } from "node:stream";

const heard = [];
const stage = async function* (source, options) {
  heard.push("stage: " + String(options.signal));
  yield* source;
};
const first = async function* (options) {
  heard.push("first: " + String(options.signal));
  yield "made";
};
function run(stages) {
  heard.length = 0;
  return new Promise(done => {
    const sink = new Writable({
      write(chunk, encoding, written) {
        heard.push(String(chunk));
        written();
      },
    });
    try {
      pipeline(...stages, sink, error => done(error ? error.name : "ended"));
    } catch (error) {
      done("threw " + error.name);
    }
  });
}
let asked = 0;
function lay(value) {
  Object.defineProperty(AbortController.prototype, "signal", {
    configurable: true,
    get() {
      asked++;
      return value;
    },
  });
}

for (let round = 0; round < 2; round++) console.log("as built:", await run([Readable.from(["up"])]), heard.join());
console.log("as built:", await run([Readable.from(["up"]), stage]), heard.join());
for (const value of [undefined, null, { toString: () => "made up", aborted: false }]) {
  lay(value);
  console.log(String(value), "streams alone:", await run([Readable.from(["up"])]), heard.join(), asked);
  console.log(String(value), "a stage:", await run([Readable.from(["up"]), stage]), heard.join(), asked);
  console.log(String(value), "a first function:", await run([first]), heard.join(), asked);
}
