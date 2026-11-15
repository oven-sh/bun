// One fixed script over node:events, node:stream and node:fs. A deed holds calls of the library and as little else as it can: what the deed itself calls is counted too,
// alike in both kinds of run. Whoever writes a second way for compiled code into the library lays a deed here that takes it.
import { test } from "bun:test";
import { during, lay, refused, restore } from "./count.js";
const EventEmitter = require("node:events");
const { Readable, Writable, Transform } = require("node:stream");
const fs = require("node:fs");
const { createHook } = require("node:async_hooks");
const { devNull } = require("node:os");
const turn = () => new Promise(resolve => setImmediate(resolve));
const deeds = {
  "an emitter is made, listened to and emits": () => {
    const emitter = new EventEmitter();
    const listener = () => {};
    emitter.on("made", listener);
    emitter.once("made", listener);
    emitter.emit("made", 1, 2);
    emitter.off("made", listener);
    emitter.listenerCount("made");
    emitter.removeAllListeners();
  },
  "an emitter that captures rejections": () => {
    new EventEmitter({ captureRejections: true });
  },
  "a readable is made and read": async () => {
    const readable = new Readable({
      read() {
        this.push("a");
        this.push(null);
      },
    });
    readable.on("data", () => {});
    await turn();
    await turn();
  },
  "a writable is written and ended": async () => {
    const writable = new Writable({
      write(chunk, encoding, done) {
        done();
      },
    });
    writable.write("a");
    writable.end("b");
    await turn();
  },
  "a transform passes a chunk on": async () => {
    const transform = new Transform({
      transform(chunk, encoding, done) {
        done(null, chunk);
      },
    });
    transform.on("data", () => {});
    transform.end("a");
    await turn();
    await turn();
  },
  "a tick under a hook": async () => {
    const hook = createHook({ init() {} }).enable();
    process.nextTick(() => {});
    await turn();
    hook.disable();
  },
  "a file is written through a stream": async () => {
    const stream = fs.createWriteStream(devNull);
    await new Promise(resolve => stream.end("a", resolve));
  },
};
test("census", async () => {
  const told = [];
  lay();
  try {
    for (const label in deeds) told[told.length] = await during(label, deeds[label]);
  } finally {
    restore();
  }
  for (const name of refused) console.log("refused: " + name);
  for (const [label, said] of told) {
    console.log("== " + label);
    for (const line of said.sort()) console.log(line);
  }
});
