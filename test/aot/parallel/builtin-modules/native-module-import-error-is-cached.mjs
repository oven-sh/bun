// A user-defined accessor on process throws while import() loads node:process. Every later import() of the module rejects with the same error without reading anything, even after the accessor stops throwing. require() keeps returning process.
// Alone: the output depends on which built-in modules were loaded earlier in the same executable
const log = [];
const show = what => {
  console.log(what + ":", log.join(" ") || "nothing");
  log.length = 0;
};
const made = text => text.split("").join("");
let throws = true;
Object.defineProperty(process, "first", {
  get() {
    log.push("first");
    return 1;
  },
  enumerable: true,
  configurable: true,
});
Object.defineProperty(process, "second", {
  get() {
    log.push("second");
    if (throws) throw new Error("the accessor threw");
    return 2;
  },
  enumerable: true,
  configurable: true,
});
const errors = [];
const loads = {
  "the first import": () => import("node:process"),
  "the same name again": () => import("node:process"),
  "a name made at run time": () => import(made("node:process")),
  "a prefix and the rest": () => import("node:" + ["process"][0]),
  "the name without its prefix": () => import("process"),
};
for (const [what, load] of Object.entries(loads)) {
  await load().then(
    loaded => console.log("loaded", loaded.second),
    error => errors.push(error),
  );
  show(what);
  throws = false;
}
console.log(errors.length, errors.every(error => error === errors[0]), errors[0].message);
console.log(require("node:process") === process, require(made("node:process")) === process, process.getBuiltinModule("process") === process);
show("require");
console.log(process.second);
show("a read of the accessor");
