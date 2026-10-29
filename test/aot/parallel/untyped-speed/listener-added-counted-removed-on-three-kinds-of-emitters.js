// A listener is added, counted and removed on three kinds of emitters of node:events and node:stream in turn, three thousand turns. The three kinds keep the table of listeners and their number
// in one form, so the functions of node:events ask once which kind they have been given, not at each field.
// COUNT: branches <= 139000
const { EventEmitter } = require("node:events");
const { Readable, Writable } = require("node:stream");

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
console.log(
  run(
    [
      new EventEmitter(),
      new Readable({ read() {} }),
      new Writable({
        write(chunk, encoding, done) {
          done();
        },
      }),
    ],
    3000,
  ),
);
