import { Writable } from "node:stream";
const { WritableState } = Writable;
const lines = [];
function made(options) {
  const state = Object.create(WritableState.prototype);
  WritableState.call(state, options(state), null, false);
  return state;
}
{
  const state = made(state => ({
    get decodeStrings() {
      state.allBuffers = false;
      state.allNoop = false;
      return true;
    },
  }));
  lines.push("cleared in between " + state.allBuffers + " " + state.allNoop);
}
{
  const state = made(state => ({
    get highWaterMark() {
      lines.push("while " + [state.allBuffers, state.allNoop, state.sync, state.constructed].join());
      return 5;
    },
  }));
  lines.push(
    "behind " + [state.allBuffers, state.allNoop, state.highWaterMark].join() + " " + Object.keys(state).join(),
  );
}
{
  const state = made(state => ({
    get defaultEncoding() {
      state.buffered = [{}];
      return undefined;
    },
  }));
  try {
    lines.push("buffered in between " + state.bufferedRequestCount + " " + state.getBuffer().length);
  } catch (error) {
    lines.push("buffered in between threw " + error.name);
  }
}
console.log(lines.join("\n"));
process.exit(0);
