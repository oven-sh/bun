// `sys` is an older name of node:util, and bun:test is asked for outside of the test runner.
function attempt(name, load) {
  try {
    const loaded = load();
    console.log(name, typeof loaded, Object.keys(loaded ?? {}).length);
  } catch (error) {
    console.log(name, "threw", error.name, error.code);
  }
}
attempt("sys", () => require("sys"));
attempt("node:sys", () => require("node:sys"));
attempt("bun:test", () => require("bun:test"));
console.log(require("sys") === require("node:util"), require("sys").format("%s!", "formatted"));
