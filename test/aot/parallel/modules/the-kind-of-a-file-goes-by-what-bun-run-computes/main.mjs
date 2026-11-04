// A file that names nothing of CommonJS is an ES module, and strict. `bun run` writes a constant in place of its name and computes with constants, so a require() behind such a condition is gone
// before it asks what the file is. `bun build` computes less unless it is told --minify-syntax, and its bundle is strict all over: the kind of a file goes by `bun run`, whatever the build was told.
import "./removed-00.js";
import "./removed-01.js";
import "./removed-02.js";
import "./removed-03.js";
import "./removed-04.js";
import "./removed-05.js";
import "./removed-06.js";
import "./removed-07.js";
import "./removed-08.js";
import "./removed-09.js";
import "./removed-10.js";
import "./removed-11.js";
import "./removed-12.js";
import "./kept-00.js";
import "./kept-01.js";
import "./kept-02.js";
import "./kept-03.js";
// `bun run` runs a CommonJS file when its text has come, and the texts come as the threads that read them please.
console.log(globalThis.kinds.sort().join("\n"));
