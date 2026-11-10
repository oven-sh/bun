import { EventEmitter } from "node:events";
import stream from "node:stream";
const lines = [];
class Borrower extends EventEmitter {
  constructor() {
    super();
    this._readableState = { ended: false };
  }
  destroy(error) {
    return stream.Readable.prototype.destroy.call(this, error);
  }
  _destroy(error, callback) {
    callback(error);
  }
  pipe() {}
}
const one = new Borrower();
one.on("error", error => lines.push("error " + error.message));
const mine = new Error("mine");
one.destroy(mine);
lines.push(
  "errored " +
    (one._readableState.errored === mine) +
    " keys " +
    Object.keys(one._readableState).join() +
    " isErrored " +
    stream.isErrored(one),
);
const two = new stream.Readable({ read() {} });
two._readableState = { errored: null, closed: false };
two.on("error", () => {});
two.destroy(new Error("told"));
lines.push("another object " + (two.errored ? two.errored.message : two.errored));
for (const make of [() => new stream.Readable({ read() {} }), () => new stream.Writable({ write() {} })]) {
  const three = make();
  const state = three._readableState ?? three._writableState;
  const said = [];
  Object.defineProperty(state, "errored", {
    configurable: true,
    get() {
      said.push("get");
      return null;
    },
    set(value) {
      said.push("set " + value.message);
    },
  });
  three.on("error", () => {});
  three.destroy(new Error("laid"));
  lines.push("own accessor " + said.join());
}
setTimeout(() => {
  lines.push("later " + (one._readableState.errored === mine));
  console.log(lines.join("\n"));
  process.exit(0);
}, 20);
