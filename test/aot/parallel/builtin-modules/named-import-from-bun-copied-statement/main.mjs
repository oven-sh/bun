// `import { a } from "bun"` copies Bun.a when the statement runs, once per importing file, like `var { a } = Bun`: later changes to Bun.a are not seen, a user-defined accessor runs once, and a module evaluated earlier in the same graph is seen. The namespace and default imports are Bun itself. `export .. from "bun"` loads the module, whose exports are captured when it loads.
// Alone: the output depends on which built-in modules were loaded earlier in the same executable
const log = [];
globalThis.note = text => log.push(text);
const show = what => {
  console.log(what + ":", log.join(", ") || "nothing");
  log.length = 0;
};
Bun.custom = 1;
for (const key of ["countedB", "countedA"])
  Object.defineProperty(Bun, key, {
    get() {
      note("get " + key);
      return key;
    },
    enumerable: true,
    configurable: true,
  });

const first = await import("./first.mjs");
show("first.mjs loads");
Bun.custom = 2;
Bun.late = 3;
console.log(first.read());
show("first.mjs reads");
console.log(first.custom, Object.keys(first).join());

const second = await import("./second.mjs");
show("second.mjs loads");
Bun.custom = 4;
console.log(first.read());
console.log(second.read());
show("both read");

const reexports = await import("./reexports.mjs");
show("reexports.mjs loads");
Bun.custom = 5;
console.log(reexports.custom, reexports.all.custom, reexports.all === Bun, reexports.countedA, reexports.read());
show("reexports.mjs is read");
delete Bun.custom;
console.log(first.read());
console.log(second.read());
console.log(reexports.custom, reexports.read());
