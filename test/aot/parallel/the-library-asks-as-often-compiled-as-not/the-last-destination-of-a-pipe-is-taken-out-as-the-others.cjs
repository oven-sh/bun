const { Readable, Writable } = require("node:stream");
const sink = () => new Writable({ write(chunk, encoding, done) { done(); } });
for (const which of [0, 1, 2]) {
  const source = new Readable({ read() {} });
  const sinks = [sink(), sink(), sink()];
  for (const each of sinks) source.pipe(each);
  const list = source._readableState.pipes;
  Object.defineProperty(list, "constructor", {
    get() {
      console.log("the list is asked for its constructor, destination", which);
      return Array;
    },
  });
  source.unpipe(sinks[which]);
  console.log(which, list.length, source._readableState.pipes === list);
}
const alone = new Readable({ read() {} });
const only = sink();
alone.pipe(only);
alone._readableState.pipes.splice = function (...given) {
  console.log("a splice of its own:", given.join());
  return Array.prototype.splice.apply(this, given);
};
alone._readableState.pipes.pop = function () {
  console.log("a pop of its own");
  return Array.prototype.pop.call(this);
};
alone.unpipe(only);
console.log(alone._readableState.pipes.length);
