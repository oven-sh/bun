// Flags: --aot-harden=proof-checks
// Both arms of an if name an object anew. The handler of a loop behind them takes the join of the names for the object.
class State {
  constructor() {
    this.left = 0;
  }
}
class Writer {
  state;
  constructor(options = {}) {
    const read = this.options;
    this.state = new State();
  }
  push(data) {
    const state = this.state;
    if (data) state.input = new Uint8Array(data);
    else state.input = data;
    for (;;) {
      try {
        if (state.left === 0) {
        }
        if (data === -2) break;
      } finally {
      }
    }
    this.said = state.said;
  }
}
function write(input, options = {}) {
  const writer = new Writer(options);
  writer.push(input);
}
const defaults = { size: 64 };
class Reader {
  constructor(options = {}) {
    this.options = Object.assign({}, defaults, options);
    this.state = new State();
  }
  push(data) {
    const state = this.state;
    const size = this.options.size;
    for (;;) {
      state.left = size;
    }
  }
}
function read(input, options = {}) {
  const reader = new Reader(options);
  reader.push(input);
}
function work(i) {
  const written = write(undefinedText + i);
  return read(written, { to: "string" }).length;
}
for (let i = 0; i < 3; i++) {
  try {
    work(i);
  } catch (error) {
    console.log(error.name);
  }
}
