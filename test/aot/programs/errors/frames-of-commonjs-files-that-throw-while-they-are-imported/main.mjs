// Imports CommonJS files that throw while they run, and prints the frames of each error.
function framesOf(stack) {
  return String(stack)
    .split("\n")
    .map(text => /^\s*at (.*?) ?\(?[^ ()]*[\/\\]([\w.-]+):(\d+):(\d+)\)?$/.exec(text))
    .filter(found => found !== null)
    .map(found => found[1] + "@" + found[2] + ":" + found[3] + ":" + found[4])
    .join(" < ");
}
async function show(label, load) {
  try {
    const loaded = await load();
    console.log(label, "|", framesOf(loaded.frames));
  } catch (error) {
    console.log(label, "|", framesOf(error.stack));
  }
}
await show("where it is used", () => import("./imported-where-it-is-used.cjs"));
await show("once more", () => import("./imported-where-it-is-used.cjs"));
await show("by a module", () => import("./imports.mjs"));
await show("by name", () => import("./imports-a-name.mjs"));
await show("whole", () => import("./imports-all.mjs"));
await show("a file that assigns to exports", () => import("./assigns-to-exports.cjs"));
await show("strict code", () => import("./strict.cjs"));
await show("caught in the file", () => import("./catches.cjs"));
