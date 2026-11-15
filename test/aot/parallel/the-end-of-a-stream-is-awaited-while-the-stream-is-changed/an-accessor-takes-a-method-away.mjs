import { Duplex, finished } from "node:stream";
import { EventEmitter } from "node:events";

const lines = [];
const settle = () => new Promise(resolve => setImmediate(() => setImmediate(resolve)));
async function watch(title, stream, then) {
  let said = "nothing yet";
  finished(stream, error => {
    said = error ? (error.code ?? error.name) : "ended";
  });
  then?.();
  await settle();
  lines.push(title + ": " + said);
}
const both = { autoDestroy: false, read() { this.push(null); }, write(chunk, encoding, done) { done(); } };

for (const takes of [false, true]) {
  let armed = false;
  class Hose extends Duplex {
    get writableFinished() {
      if (armed) {
        armed = false;
        this.pipe = undefined;
      }
      return super.writableFinished;
    }
  }
  const hose = new Hose(both);
  hose.resume();
  await settle();
  armed = takes;
  await watch("writableFinished " + (takes ? "takes pipe away" : "leaves pipe"), hose, () => hose.end());
}
for (const takes of [false, true]) {
  let armed = takes;
  const old = new EventEmitter();
  old.write = () => true;
  old.writableFinished = true;
  Object.defineProperty(old, "_sent100", {
    get() {
      if (armed) {
        armed = false;
        old.write = undefined;
      }
      return undefined;
    },
  });
  await watch("_sent100 " + (takes ? "takes write away" : "leaves write"), old);
}
console.log(lines.join("\n"));
