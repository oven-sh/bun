// What the native code of `bun:desktop` takes from Node's modules. Were it to load them itself, the compiler would keep all of them in every program that has one.
export default {
  childProcess: () => require("node:child_process"),
  dns: () => require("node:dns"),
  events: () => require("node:events"),
  fs: () => require("node:fs"),
  os: () => require("node:os"),
  // node:stream completes these classes, but the program can replace what it exports.
  readable: () => (require("node:stream"), require("internal/streams/readable")),
  stream: () => require("node:stream"),
  tls: () => require("node:tls"),
  url: () => require("node:url"),
  writable: () => (require("node:stream"), require("internal/streams/writable")),
};
