// A user-defined accessor on Bun runs each time a file reads it through the namespace or default import of "bun", and not while that file loads.
const log = [];
const show = what => {
  console.log(what + ":", log.join(" ") || "nothing");
  log.length = 0;
};
globalThis.noteStart = () => log.push("the file starts");
for (const key of ["custom", "other"])
  Object.defineProperty(Bun, key, {
    get() {
      log.push(key);
      return key.length;
    },
    enumerable: true,
    configurable: true,
  });
const file = await import("./imports-bun.mjs");
show("import of the file");
console.log(file.read(), file.read());
show("two calls that read the imports");
console.log(require("bun") === Bun);
show("require");
const loaded = await import("bun");
show("import of bun");
console.log(loaded.custom, loaded.other, loaded.custom);
show("reads of its exports");
console.log((await import("bun")) === loaded);
show("import of bun again");
