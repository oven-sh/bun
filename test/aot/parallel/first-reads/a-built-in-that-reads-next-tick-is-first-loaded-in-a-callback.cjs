// A callback is the first to load node:stream, whose modules read process.nextTick, outside a microtask. The stream emits 'finish' from a tick, and a listener that is added after an await is in time for it.
setImmediate(async () => {
  const { Writable } = require("node:stream");
  const sink = new Writable({
    write(chunk, encoding, callback) {
      Promise.resolve().then(() => callback());
    },
  });
  const written = new Promise(resolve => sink.write("a", resolve));
  sink.end();
  await written;
  await new Promise(resolve => sink.once("finish", resolve));
  console.log("finished");
});
