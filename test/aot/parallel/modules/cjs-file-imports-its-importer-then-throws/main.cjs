// While require() loads an ES module, a CommonJS file of the graph calls import() of a module above it in that graph, and then throws.
// The call is no part of the graph that the require() loads, so what the file throws reaches the require(). `bun run` takes the steps of the call inside it, leaves an empty record for the running file and loses the error.
// The files of a graph run while the graph is loaded, each of them, whatever another has thrown, as in `bun run`: docs/compiler/compatibility.mdx, "Loader hooks and the module cache". So in "sibling" and "module" the file runs ahead of the ES module beside it, and in "before" the second file runs though the first has thrown. `bun build --compile` and Node.js run each at its place.
// A file that threw under an import keeps its error, as in `bun run`: "again". `bun build --compile` hands out what the file had exported, Node.js runs it once more.
globalThis.say = (...words) => console.log(...words);
globalThis.text = error => error.message.split(" in module")[0];
try {
  require("./bare/module.mjs");
  say("bare: required");
} catch (error) {
  say("bare: threw", text(error));
}
try {
  require("./named/module.mjs");
  say("named: required");
} catch (error) {
  say("named: threw", text(error));
}
try {
  require("./inner/module.mjs");
  say("inner: required");
} catch (error) {
  say("inner: threw", text(error));
}
try {
  require("./helper/module.mjs");
  say("helper: required");
} catch (error) {
  say("helper: threw", text(error));
}
try {
  require("./sibling/module.mjs");
  say("sibling: required");
} catch (error) {
  say("sibling: threw", text(error));
}
try {
  require("./before/module.mjs");
  say("before: required");
} catch (error) {
  say("before: threw", text(error));
}
try {
  require("./outside/module.mjs");
  say("outside: required");
} catch (error) {
  say("outside: threw", text(error));
}
try {
  require("./module/module.mjs");
  say("module: required");
} catch (error) {
  say("module: threw", text(error));
}
try {
  require("./whole/module.mjs");
  say("whole: required");
} catch (error) {
  say("whole: threw", text(error));
}
try {
  require("./stores/module.mjs");
  say("stores: required");
} catch (error) {
  say("stores: threw", text(error));
}
for (const kind of ["handed", "exported"]) {
  try {
    say(kind + ": required", Object.keys(kind === "handed" ? require("./handed/module.mjs") : require("./exported/module.mjs")).join());
  } catch (error) {
    say(kind + ": threw", text(error));
  }
}
try {
  require("./barrel/module.mjs");
  say("barrel: required");
} catch (error) {
  say("barrel: threw", text(error));
}
try {
  require("./again/module.mjs");
  say("again: required");
} catch (error) {
  say("again: threw", text(error));
}
try {
  say("again: the file once more", JSON.stringify(require("./again/file.cjs")));
} catch (error) {
  say("again: the file once more threw", text(error));
}
import("./again/file.cjs").then(names => say("again: the file imported", JSON.stringify(Object.keys(names)), names.default), error => say("again: the file rejected", text(error)));
import("./again/late.mjs").then(() => say("again: late.mjs loaded"), error => say("again: late.mjs rejected", text(error)));
/* Output:
bare: the file runs
bare: threw the bare file throws
named: the file runs
named: threw the named file throws
inner: the file runs
inner: threw the inner file throws
helper: the file runs
helper: the helper runs
helper: threw the file with a helper throws
sibling: the file runs
sibling: threw the file beside throws
before: the first file runs
before: the file runs
before: threw the first file throws
outside: the file runs
outside: threw the file below throws
module: the file runs
module: the thrower runs
module: threw the ES module throws
whole: the file runs
whole: threw the whole file throws
stores: the file runs
stores: threw the file that only stores throws
handed: the file runs
handed: threw the file of handed throws
exported: the file runs
exported: threw the file of exported throws
barrel: the file runs
barrel: threw the file behind the barrel throws
again: the file runs
again: threw the file asked for again throws
again: the file once more threw the file asked for again throws
sibling: the other module runs
again: the file rejected the file asked for again throws
bare: module.mjs rejected the bare file throws
named: module.mjs rejected the named file throws
inner: between.mjs rejected the inner file throws
helper: module.mjs rejected the file with a helper throws
before: module.mjs rejected the first file throws
whole: module.mjs rejected the whole file throws
stores: module.mjs rejected the file that only stores throws
handed: module.mjs rejected the file of handed throws
exported: module.mjs rejected the file of exported throws
barrel: module.mjs rejected the file behind the barrel throws
again: module.mjs rejected the file asked for again throws
sibling: other.mjs loaded
module: module.mjs rejected the ES module throws
outside: above.mjs rejected the file below throws
again: late.mjs rejected the file asked for again throws
*/
