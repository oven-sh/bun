// While require() loads an ES module, a CommonJS file of the graph calls import() of a module above it in that graph, and then throws.
// The loader takes the steps of the import() inside the call. They reach the running file and leave an empty record for it, and what the file throws is lost.
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
