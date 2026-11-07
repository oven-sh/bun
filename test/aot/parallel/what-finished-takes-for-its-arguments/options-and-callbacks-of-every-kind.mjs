// finished(stream, options, callback) of node:stream: which options and which callbacks are taken, which are refused and in what words.
import { Readable, finished } from "node:stream";

const kinds = {
  "nothing": undefined,
  "null": null,
  "a number": 5,
  "zero": 0,
  "a text": "text",
  "an empty text": "",
  "true": true,
  "a symbol": Symbol("s"),
  "a big number": 10n,
  "an object": {},
  "an object without a prototype": Object.create(null),
  "a list": [],
  "a list with something in it": [1],
  "a function": () => {},
  "a class": class {},
  "a date": new Date(0),
  "a map": new Map(),
  "a pattern": /x/,
  "a proxy of an object": new Proxy({}, {}),
  "a proxy of a list": new Proxy([], {}),
  "a proxy of a function": new Proxy(() => {}, {}),
  "an heir of a list": new (class extends Array {})(),
  "an object whose prototype is a list": Object.create([]),
  "arguments": (function () { return arguments; })(),
  "bytes": new Uint8Array(2),
};
function attempt(title, ...args) {
  try {
    console.log(title, "| taken", typeof finished(...args));
  } catch (error) {
    console.log(title, "| refused", error.constructor.name, error.code, error.message.split("\n")[0]);
  }
}
for (const kind in kinds) attempt("options: " + kind, new Readable({ read() {} }), kinds[kind], () => {});
for (const kind in kinds) attempt("callback: " + kind, new Readable({ read() {} }), {}, kinds[kind]);
for (const kind in kinds) attempt("two arguments, the second: " + kind, new Readable({ read() {} }), kinds[kind]);
attempt("one argument", new Readable({ read() {} }));
attempt("four arguments", new Readable({ read() {} }), {}, () => {}, 5);
