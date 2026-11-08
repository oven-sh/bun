// Modules call a function that `createRequire()` made, and the file that it loads throws. The program prints the frames of each error.
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
await show(() => import("./called-where-it-is-written.mjs"));
await show(() => import("./called-by-name.mjs"));
await show(() => import("./under-another-name.mjs"));
