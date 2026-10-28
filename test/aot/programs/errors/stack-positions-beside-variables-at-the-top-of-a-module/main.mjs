// Imports modules in which the value of a variable at the top is converted by code that throws, and prints the frames of each error.
async function show(load) {
  try {
    await load();
    console.log("no error");
  } catch (error) {
    console.log(
      String(error.stack)
        .split("\n")
        .map(text => /^\s*at (.*?) ?\(?[^ ()]*[\/\\]([\w.-]+):(\d+):(\d+)\)?$/.exec(text))
        .filter(found => found !== null)
        .map(found => found[1] + "@" + found[2] + ":" + found[3] + ":" + found[4])
        .join(" < "),
    );
  }
}
await show(() => import("./constant.mjs"));
await show(() => import("./variable.mjs"));
await show(() => import("./exported-constant.mjs"));
await show(() => import("./method-in-the-literal.mjs"));
await show(() => import("./handed-to-string.mjs"));
await show(() => import("./added.mjs"));
await show(() => import("./var-variable.mjs"));
await show(() => import("./read-by-a-function.mjs"));
await show(() => import("./behind-another-constant.mjs"));
await show(() => import("./behind-a-literal.mjs"));
