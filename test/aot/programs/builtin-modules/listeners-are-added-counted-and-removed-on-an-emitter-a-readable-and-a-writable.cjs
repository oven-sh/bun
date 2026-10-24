// One loop adds a listener, counts the listeners and removes it again, in turn on a plain emitter, a readable and a writable stream.
const { EventEmitter } = require("node:events");
const { Readable, Writable } = require("node:stream");
function listener() {}
function run(emitters, turns) {
  let counted = 0;
  for (let i = 0; i < turns; i++) {
    const emitter = emitters[i % emitters.length];
    emitter.on("thing", listener);
    counted += emitter.listenerCount("thing");
    emitter.removeListener("thing", listener);
  }
  return counted;
}
const emitters = [
  new EventEmitter(),
  new Readable({ read() {} }),
  new Writable({
    write(chunk, encoding, done) {
      done();
    },
  }),
];
console.log(run(emitters, 300_000), run(emitters.slice(0, 1), 100_000), run(emitters.slice(1), 100_000));
console.log(emitters.map(emitter => emitter.listenerCount("thing") + " " + emitter.eventNames().length).join());
