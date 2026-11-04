// Imports files whose top level gives undefined to a list pattern, or an object with a getter that throws to the rest of an object pattern, behind a declaration of the statement in front or of the pattern's own statement, and prints the frames of each error. Bun's transpiler prints each declaration at the top level of a file as a statement of its own, so a frame names the `const`, `let` or `var` of the pattern's statement, or the `[` or the `{` of the pattern where that stands on another line than this keyword.
function framesOf(error) {
  return String(error.stack)
    .split("\n")
    .map(text => /^\s*at (.*?) ?\(?[^ ()]*[\/\\]([\w.-]+):(\d+):(\d+)\)?$/.exec(text))
    .filter(found => found !== null)
    .map(found => found[1] + "@" + found[3] + ":" + found[4])
    .join(" < ");
}
async function show(load) {
  try {
    await load();
    console.log("no error");
  } catch (error) {
    console.log(error.message, "|", framesOf(error));
  }
}
await show(() => import("./behind-a-statement.mjs"));
await show(() => import("./below-its-keyword.mjs"));
await show(() => import("./in-its-statement.mjs"));
await show(() => import("./in-its-statement-on-one-line.mjs"));
await show(() => import("./in-its-statement-on-a-line-below.mjs"));
await show(() => import("./behind-a-var.cjs"));
await show(() => import("./behind-two-names.ts"));
await show(() => import("./rest-behind-a-statement.mjs"));
await show(() => import("./rest-in-its-statement.mjs"));
