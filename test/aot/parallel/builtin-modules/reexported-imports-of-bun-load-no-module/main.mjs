// A file that imports the namespace, the default export or a name from "bun" and exports it again exports its own variable: no module is loaded for it, so a user-defined accessor on Bun runs only for the name that is copied.
// Alone: the output depends on which built-in modules were loaded earlier in the same executable
const log = [];
globalThis.note = text => log.push(text);
const show = what => {
  console.log(what + ":", log.join(", ") || "nothing");
  log.length = 0;
};
Bun.custom = 1;
for (const key of ["counted", "other"])
  Object.defineProperty(Bun, key, {
    get() {
      note("get " + key);
      return key;
    },
    enumerable: true,
    configurable: true,
  });
const file = await import("./exports-again.mjs");
show("exports-again.mjs loads");
Bun.custom = 2;
console.log(file.all === Bun, file.bun === Bun, file.custom, file.counted, typeof file.version, typeof file.argv, Object.keys(file).join());
show("its exports are read");
const importer = await import("./importer.mjs");
show("importer.mjs loads");
console.log(importer.read());
show("importer.mjs reads");
