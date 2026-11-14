// COUNT: operation:operationAOTDefineField = 0
// The flags of node:stream are const enums, and each use of them is a number: no object holds their names when the module is loaded.
import { Duplex, PassThrough, Readable, Transform, Writable, finished, pipeline } from "node:stream";

const lines = [];
const source = Readable.from(["a", "bc", "def"], { objectMode: true });
const upper = new Transform({
  objectMode: true,
  transform(chunk, _, done) {
    done(null, String(chunk).toUpperCase());
  },
});
const sink = new Writable({
  objectMode: true,
  highWaterMark: 2,
  write(chunk, _, done) {
    lines.push(`${chunk} ${this.writableLength} ${this.writableNeedDrain}`);
    queueMicrotask(done);
  },
});
pipeline(source, upper, new PassThrough({ objectMode: true }), sink, error => {
  lines.push(`${error} ${source.destroyed} ${upper.readableEnded} ${sink.writableFinished} ${sink.closed}`);
  const state = new Duplex({ read() {}, write(_c, _e, done) { done(); } });
  lines.push(
    Object.keys(state._readableState).slice(0, 4).join() + " " + state._readableState.objectMode + state._readableState.ended + state._writableState.autoDestroy + state._writableState.sync,
  );
  state._readableState.ended = true;
  lines.push(String(state._readableState.ended) + state.readableEnded);
  finished(state, problem => {
    lines.push(`${problem?.code} ${state.destroyed} ${state.errored?.message}`);
    console.log(lines.join("\n"));
  });
  state.destroy(new Error("over"));
});
