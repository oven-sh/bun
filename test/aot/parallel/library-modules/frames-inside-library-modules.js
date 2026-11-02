// A stack trace shows the functions, the modules and the positions inside the library as `bun run` shows them, before and behind a look at the name of a function.
const crypto = require("node:crypto");

function showLibraryFrames(label, run) {
  try {
    run();
  } catch (error) {
    const frames = error.stack
      .split("\n")
      .filter(frame => /\((?:node|internal|bun):|\(unknown\)|\(native\)/.test(frame));
    console.log(label, frames.map(frame => frame.trim()).join(" | "));
  }
}

const key = Buffer.alloc(16);
function tryAll(label) {
  showLibraryFrames(label + " new Cipheriv", () => new crypto.Cipheriv("no such cipher", key, key));
  showLibraryFrames(label + " Cipheriv", () => crypto.Cipheriv("no such cipher", key, key));
  showLibraryFrames(label + " createCipheriv", () => crypto.createCipheriv("no such cipher", key, key));
  showLibraryFrames(label + " new Decipheriv", () => new crypto.Decipheriv("no such cipher", key, key));
  showLibraryFrames(label + " new Hmac", () => new crypto.Hmac("no such digest", key));
}

tryAll("first");
console.log(Object.getOwnPropertyDescriptor(crypto.Cipheriv, "name"), Reflect.ownKeys(crypto.Decipheriv));
tryAll("then");

process.noDeprecation = true;
showLibraryFrames("through a module under internal", () => new crypto.Hash("no such digest"));

const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const zlib = require("node:zlib");
showLibraryFrames("an error that a module makes by its code", () => new EventEmitter().on("event", 1));
showLibraryFrames("below a function that is called with a receiver", () => new zlib.Gzip({ chunkSize: 1 }));
showLibraryFrames("a callback that is none", () => fs.readFile("nowhere", 1));
showLibraryFrames("behind an else", () => require("node:timers").active({}));
showLibraryFrames("an error class that the module constructs", () => require("node:tls").setDefaultCACertificates(1));
showLibraryFrames("a call of the base class", () => new (require("node:perf_hooks").PerformanceObserver)(1));
showLibraryFrames("three functions deep", () => zlib.inflateSync(1));
