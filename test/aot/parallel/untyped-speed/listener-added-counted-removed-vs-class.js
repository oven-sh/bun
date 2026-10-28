// A listener is added, counted and removed, on three kinds of emitters of node:events and node:stream in turn, and on three objects of a class written here that keeps its
// listeners the same way: a table without a prototype, a function alone under its name, a count. The library checks more, which may cost a few times as much a turn.
// Todo: Not every time: a clock. Compiled, a turn on the emitters of the library takes over three times as long as one on the class written here
const { EventEmitter } = require("node:events");
const { Readable, Writable } = require("node:stream");

class Plain {
  table = { __proto__: null };
  count = 0;
  on(name, listener) {
    if (typeof listener !== "function") throw new TypeError("no function");
    const present = this.table[name];
    if (present === undefined) {
      this.table[name] = listener;
      ++this.count;
    } else if (typeof present === "function") this.table[name] = [present, listener];
    else present.push(listener);
    return this;
  }
  listenerCount(name) {
    const present = this.table[name];
    return present === undefined ? 0 : typeof present === "function" ? 1 : present.length;
  }
  removeListener(name, listener) {
    const present = this.table[name];
    if (present === listener) {
      if (--this.count === 0) this.table = { __proto__: null };
      else delete this.table[name];
    }
    return this;
  }
}

function listener() {}
function run(emitters, turns) {
  let n = 0;
  for (let i = 0; i < turns; i++) {
    const emitter = emitters[i % 3];
    emitter.on("thing", listener);
    n += emitter.listenerCount("thing");
    emitter.removeListener("thing", listener);
  }
  return n;
}
function fastestOf(runs, emitters, turns) {
  let fastest = Infinity;
  for (let i = 0; i < runs; i++) {
    const began = performance.now();
    if (run(emitters, turns) !== turns) console.log("a listener was not counted");
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
const ofLibrary = [
  new EventEmitter(),
  new Readable({ read() {} }),
  new Writable({
    write(chunk, encoding, done) {
      done();
    },
  }),
];
const written = fastestOf(5, [new Plain(), new Plain(), new Plain()], 300000);
const library = fastestOf(5, ofLibrary, 300000);
console.log(library < written * 3 ? "under three times the time" : "over three times the time");
