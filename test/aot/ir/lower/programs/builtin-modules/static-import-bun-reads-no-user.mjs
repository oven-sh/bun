// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2
// CHECK-LABEL: function {{*}}name="show"
// CHECK-LABEL: function {{*}}name="get"

// FILE: main.mjs
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

// FILE: imports-bun.mjs
import * as all from "bun";
import bun from "bun";
noteStart();
export const read = () => [all.custom, all.other, bun.custom].join();

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
