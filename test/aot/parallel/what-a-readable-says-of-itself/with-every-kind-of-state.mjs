// destroyed, closed, errored and readableEnded of a Readable: in every state of a stream, with a state that the program has put there, with none, and asked of what is no stream.
import { Duplex, Readable } from "node:stream";

const tick = () => new Promise(resolve => setImmediate(resolve));
const names = ["destroyed", "closed", "errored", "readableEnded", "readable", "readableAborted", "readableDidRead"];
function ask(title, receiver) {
  const answers = names.map(name => {
    try {
      const answer = Reflect.get(Readable.prototype, name, receiver);
      return name + "=" + (answer instanceof Error ? "Error(" + answer.message + ")" : String(answer));
    } catch (error) {
      return name + " throws " + error.constructor.name;
    }
  });
  console.log(title, "|", answers.join(" "));
}

const fresh = new Readable({ read() {} });
ask("fresh", fresh);
const ended = new Readable({ read() {} });
ended.push(null);
ended.resume();
await tick();
await tick();
ask("ended", ended);
const kept = new Readable({ autoDestroy: false, read() {} });
kept.push(null);
kept.resume();
await tick();
ask("ended, and it does not destroy itself", kept);
const destroyed = new Readable({ read() {} });
destroyed.destroy();
ask("destroyed, at once", destroyed);
await tick();
ask("destroyed, later", destroyed);
const failed = new Readable({ read() {} });
failed.on("error", () => {});
failed.destroy(new Error("failed"));
ask("failed, at once", failed);
await tick();
ask("failed, later", failed);
ask("a duplex", new Duplex({ read() {}, write() {} }));

for (const value of [undefined, null, 0, "", false, NaN, 1, "state", true, {}, [], () => {}, { destroyed: "yes", closed: "shut", errored: "bad", endEmitted: "over", readable: 0 }, Object.create(fresh._readableState), Object.create(Readable.ReadableState.prototype)]) {
  const stream = new Readable({ read() {} });
  stream._readableState = value;
  ask("a state that is " + (typeof value === "object" && value !== null ? JSON.stringify(value) : typeof value + " " + String(value)), stream);
}
const without = new Readable({ read() {} });
delete without._readableState;
ask("no state at all", without);
for (const receiver of [{}, Object.create(null), [], () => {}, 5, "text", { _readableState: destroyed._readableState }, { _readableState: failed._readableState }]) {
  ask("asked of " + (typeof receiver === "object" ? JSON.stringify(Object.keys(receiver)) : typeof receiver), receiver);
}

const reads = [];
const proxy = new Proxy(new Readable({ read() {} }), {
  get(target, key) {
    reads.push(String(key));
    return Reflect.get(target, key, target);
  },
});
ask("a proxy", proxy);
console.log(" ", reads.join());

const set = new Readable({ read() {} });
set.destroyed = true;
ask("destroyed was stored", set);
set.destroyed = 0;
ask("and taken back", set);
