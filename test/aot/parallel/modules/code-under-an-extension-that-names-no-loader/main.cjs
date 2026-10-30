// JavaScript in files whose extension names no loader, required where `bun build` does not link the call: the loader runs them, in an executable too.
const show = (name, load) => console.log(name, JSON.stringify(load()));
const load = require;
show("another name", () => load("./another-name.bin"));
show("require.call", () => require.call(null, "./require-call.conf"));
show("made", () => require("node:module").createRequire(__filename)("./made.plugin"));
show("once", () => load("./another-name.bin") === load("./another-name.bin"));
require("./module.mjs");
