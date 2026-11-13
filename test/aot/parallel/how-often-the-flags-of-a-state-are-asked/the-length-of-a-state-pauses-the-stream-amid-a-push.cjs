const { Readable } = require("node:stream");

const readable = new Readable({ objectMode: true, read() {} });
const heard = [];
readable.on("data", chunk => heard.push(chunk));
setTimeout(() => {
  const state = readable._readableState;
  let held = state.length;
  let armed = true;
  Object.defineProperty(state, "length", {
    configurable: true,
    get() {
      if (armed) {
        armed = false;
        readable.pause();
      }
      return held;
    },
    set(value) {
      held = value;
    },
  });
  console.log(readable.push("first"), readable.push("second"));
  console.log(heard.join(), readable.isPaused(), held);
}, 10);
