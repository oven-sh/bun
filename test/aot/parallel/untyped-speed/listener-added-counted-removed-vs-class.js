// A listener is added, counted and removed, on three kinds of emitters of node:events and node:stream in turn, and on three objects of a class written here that keeps its
// listeners the same way: a table without a prototype, a function alone under its name, a count. The library checks more: a turn on its emitters may ask three times the questions of a turn on the class,
// which asks twelve. Three thousand turns on each.
// Todo: a turn on the emitters of the library asks 58 questions
// COUNT: branches <= 145000
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
const ofLibrary = [
  new EventEmitter(),
  new Readable({ read() {} }),
  new Writable({
    write(chunk, encoding, done) {
      done();
    },
  }),
];
console.log(run([new Plain(), new Plain(), new Plain()], 3000), run(ofLibrary, 3000));
