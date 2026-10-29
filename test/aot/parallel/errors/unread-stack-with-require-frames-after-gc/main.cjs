// A GC formats the stack of an error early when a function in its frames has died. Each stack here has the frame of the function that require() runs a file in.
globalThis.errors = [];
const files = [() => require("./commonjs.cjs"), () => require("./module.mjs"), () => require("node:" + ["zlib"][0]) && require("./last.cjs")];
for (const load of files) {
  // Each file has a caller of its own, whose source is not known at build time. Nothing holds it after the call.
  new Function("load", "return [load()]; // " + Date.now())(load);
}

Bun.gc(true);

for (const error of errors) {
  const frames = error.stack.split("\n").slice(1).map(line => line.trim().replace(/^at /, "").replace(/[^ (]*\//, ""));
  console.log(frames.join(" < "));
}
