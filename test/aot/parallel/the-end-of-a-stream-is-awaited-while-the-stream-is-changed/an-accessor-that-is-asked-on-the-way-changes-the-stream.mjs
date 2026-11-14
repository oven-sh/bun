import { Readable, Writable, finished } from "node:stream";

const lines = [];
const settle = () => new Promise(resolve => setImmediate(() => setImmediate(resolve)));
async function watch(title, stream, options) {
  let said = "nothing yet";
  try {
    finished(stream, options, error => {
      said = error ? error.name + ": " + (error.code ?? error.message) : "ended";
    });
  } catch (error) {
    said = "threw " + error.name;
  }
  const atOnce = said;
  await settle();
  lines.push(title + ": at once " + atOnce + " . later " + said);
}
const quiet = { autoDestroy: false, emitClose: false };

// `closed` gives no boolean and lays the state of a stream that is closed
{
  const other = new Readable({ read() {} });
  other.destroy();
  await settle();
  class Spool extends Readable {
    get closed() {
      this._readableState = other._readableState;
      return undefined;
    }
  }
  await watch("closed says nothing and lays a closed state", new Spool({ read() {} }), {});
}
// `writableFinished` lays a state with nothing pending in the place of one with a write pending
{
  const other = new Writable({ ...quiet, write(chunk, encoding, done) { done(); } });
  other.end();
  await settle();
  class Sink extends Writable {
    get writableFinished() {
      this._writableState = other._writableState;
      return false;
    }
  }
  const sink = new Sink({ ...quiet, write() {} });
  sink.write("held");
  await watch("writableFinished lays a finished state", sink, { readable: false });
}
// `pipe` lays the state of a stream that has told an error
{
  const other = new Readable({ ...quiet, read() {} });
  other.on("error", () => {});
  other.destroy(new Error("told"));
  await settle();
  class Spool extends Readable {
    get pipe() {
      this._readableState = other._readableState;
      return super.pipe;
    }
  }
  await watch("pipe lays a state that has told an error", new Spool({ ...quiet, read() {} }), { writable: false });
}
// an accessor of the stream lays an aborted signal into the options
{
  const options = {};
  class Spool extends Readable {
    get closed() {
      options.signal = AbortSignal.abort(new Error("given up"));
      return super.closed;
    }
  }
  await watch("closed lays an aborted signal into the options", new Spool({ read() {} }), options);
}
// a listener for newListener lays another `on` between the four
{
  const stream = new Readable({ read() {} });
  const seen = [];
  stream.once("newListener", name => {
    seen.push("newListener " + String(name));
    stream.on = function (name, listener) {
      seen.push("another on: " + String(name));
      return Readable.prototype.on.call(this, name, listener);
    };
  });
  await watch("a listener for newListener lays another on", stream, {});
  lines.push("  " + seen.join(" . "));
}
// the options' own accessors lay another state
{
  const other = new Readable({ read() {} });
  other.destroy();
  await settle();
  const stream = new Readable({ read() {} });
  await watch("options.readable lays a closed state", stream, {
    get readable() {
      stream._readableState = other._readableState;
      return undefined;
    },
  });
}
console.log(lines.join("\n"));
