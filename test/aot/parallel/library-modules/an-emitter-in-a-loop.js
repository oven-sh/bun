// An emitter of node:events in a loop: listenerCount, an event nobody listens to, one listener, two listeners, a handled "error". No emit makes an array, and none asks for `_events` by name.
// COUNT: cells <= 100
// COUNT: arrivals <= 31000
// COUNT: branches <= 230000
const { EventEmitter } = require("node:events");
let heard = 0;
const listener = i => void (heard += i & 1);
const emitter = new EventEmitter();
emitter.on("tick", listener);
emitter.on("pair", listener);
emitter.on("pair", listener);
emitter.on("error", listener);
function run(turns) {
  let n = 0;
  for (let i = 0; i < turns; i++) {
    n += emitter.listenerCount("tick");
    if (emitter.emit("none", i)) n++;
    if (emitter.emit("tick", i)) n++;
    if (emitter.emit("pair", i)) n++;
    if (emitter.emit("error", i)) n++;
  }
  return n;
}
console.log(run(3000), heard);
