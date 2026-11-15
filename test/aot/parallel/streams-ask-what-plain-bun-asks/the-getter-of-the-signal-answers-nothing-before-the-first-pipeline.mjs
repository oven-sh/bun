// The getter that a program lays under AbortController.prototype.signal answers undefined before any pipeline has run: no function of a controller was kept yet.
import { pipeline, Readable, Writable } from "node:stream";

let asked = 0;
Object.defineProperty(AbortController.prototype, "signal", {
  configurable: true,
  get() {
    asked++;
    return undefined;
  },
});
const heard = [];
const stage = async function* (source, options) {
  heard.push("stage: " + String(options.signal));
  yield* source;
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
      pipeline(Readable.from(["up"]), ...stages, sink, error => done(error ? error.name : "ended"));
    } catch (error) {
      done("threw " + error.name);
    }
  });
}
console.log("streams alone:", await run([]), heard.join(), asked);
console.log("a stage:", await run([stage]), heard.join(), asked);
