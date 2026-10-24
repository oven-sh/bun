const { Readable, Writable } = require("node:stream");

function createSlowDestination(name, log, delay) {
  return new Writable({
    highWaterMark: 1,
    write(chunk, encoding, done) {
      log.push(name + ":" + chunk);
      setTimeout(done, delay);
    },
  });
}

const log = [];
let sent = 0;
const source = new Readable({
  highWaterMark: 1,
  read() {
    this.push(sent < 6 ? String(sent++) : null);
  },
});
const first = createSlowDestination("first", log, 1);
const second = createSlowDestination("second", log, 3);
const third = createSlowDestination("third", log, 2);
source.pipe(first);
source.pipe(second);
source.pipe(third);
const waiting = source._readableState.awaitDrainWriters;
console.log(waiting instanceof Set, typeof waiting.on, waiting._events, "_events" in waiting);
let finished = 0;
for (const destination of [first, second, third]) {
  destination.on("finish", () => {
    if (++finished === 3) console.log(log.join(" "), source._readableState.awaitDrainWriters.size);
  });
}
