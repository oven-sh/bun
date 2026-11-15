import { Writable, finished } from "node:stream";
import { EventEmitter } from "node:events";

const lines = [];
const settle = () => new Promise(resolve => setImmediate(() => setImmediate(resolve)));
async function watch(title, stream, options, then) {
  let said = "nothing yet";
  finished(stream, options, error => {
    said = error ? (error.code ?? error.name) : "ended";
  });
  then?.();
  await settle();
  lines.push(title + ": " + said);
}

for (const takes of [false, true]) {
  const word = takes ? " takes a method away" : " leaves all as it is";
  {
    const spool = new EventEmitter();
    spool.pipe = () => {};
    spool._readableState = {
      endEmitted: true,
      get autoDestroy() {
        if (takes) spool.pipe = undefined;
        return false;
      },
    };
    await watch("autoDestroy of a state that is not the library's" + word, spool, {});
  }
  for (const closed of [false, true]) {
    const reply = new EventEmitter();
    Object.assign(reply, {
      write: () => true,
      writable: true,
      _closed: closed,
      _defaultKeepAlive: true,
      _removedConnection: false,
      _removedContLen: false,
    });
    Object.defineProperty(reply, "_sent100", {
      get() {
        if (takes) reply.write = undefined;
        return false;
      },
    });
    await watch("_sent100 of what looks like a reply that is " + (closed ? "closed" : "open") + word, reply, {});
  }
  {
    const sink = new Writable({ write(chunk, encoding, done) { done(); } });
    const options = {
      get writable() {
        if (takes) sink.write = undefined;
        return undefined;
      },
    };
    await watch("writable of the options" + word, sink, options, () => sink.destroy());
  }
}
console.log(lines.join("\n"));
