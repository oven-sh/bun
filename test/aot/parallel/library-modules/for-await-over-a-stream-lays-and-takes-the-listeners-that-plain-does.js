// `for await (const chunk of stream)` asks end-of-stream for the readable side alone. For a plain heir of Readable what was compiled ahead of time hands it one shared bag of options that
// end-of-stream knows by identity, so that it reads no option off it and asks no question about web streams. Which listeners are laid, in which order, and which are left behind the first
// chunk and behind return() is what a program sees of that: here for a Readable, a Duplex, a PassThrough, an heir that overrides on() and removeListener(), a stream that fails,
// finished() with options of the program's own, and its callback's `this` and arguments.
const { Readable, Duplex, PassThrough, finished } = require("node:stream");

const names = ["aborted", "complete", "abort", "request", "end", "close", "finish", "error", "readable", "data"];
const counts = stream => names.map(name => stream.listenerCount(name)).join(",");

async function step(label, stream) {
  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  console.log(label, "first", String(first.value), first.done, counts(stream));
  const last = await iterator.return();
  console.log(label, "returned", last.done, counts(stream), stream.destroyed);
}

class Logged extends Readable {
  on(name, listener) {
    console.log("on", name);
    return super.on(name, listener);
  }
  removeListener(name, listener) {
    console.log("off", name);
    return super.removeListener(name, listener);
  }
  _read() {
    this.push("d");
    this.push(null);
  }
}

function settled(label, stream, options) {
  return new Promise(resolve => {
    const callback = function () {
      console.log(
        label,
        this === stream,
        arguments.length,
        arguments.length ? String(arguments[0] && arguments[0].message) : "",
      );
      resolve();
    };
    if (options) finished(stream, options, callback);
    else finished(stream, callback);
  });
}

async function main() {
  await step(
    "readable",
    new Readable({
      read() {
        this.push("a");
        this.push(null);
      },
    }),
  );
  await step(
    "duplex",
    new Duplex({
      read() {
        this.push("b");
        this.push(null);
      },
      write(chunk, encoding, done) {
        done();
      },
    }),
  );
  const through = new PassThrough();
  through.end("c");
  await step("through", through);
  await step("logged", new Logged());

  try {
    for await (const chunk of new Readable({
      read() {
        this.destroy(new Error("boom"));
      },
    }))
      console.log(chunk);
  } catch (error) {
    console.log("caught", error.message);
  }

  let text = "";
  for await (const chunk of Readable.from(["p", "q", "r"])) text += chunk;
  console.log(text);

  const ends = new Readable({ read() {} });
  const whenEnded = settled("ended", ends, { writable: false });
  ends.push(null);
  ends.resume();
  await whenEnded;

  const fails = new Readable({ read() {} });
  const whenFailed = settled("failed", fails);
  fails.destroy(new Error("gone"));
  await whenFailed;

  const silent = new Readable({ read() {} });
  silent.on("error", () => {});
  const whenClosed = settled("without error", silent, { error: false });
  console.log("listeners of error", silent.listenerCount("error"));
  silent.destroy(new Error("unheard"));
  await whenClosed;
}

main();
