// The transpiler prints `fs` where it reads `bun:fs`, also in `module.require(..)`. The loader, which every other call asks, does not know the name.
const { createRequire } = require("node:module");
const tell = load => {
  try {
    return typeof load();
  } catch (error) {
    return `${error.constructor.name} ${error.code} ${error.message.split("\n")[0]}`;
  }
};
const made = createRequire(__filename);
console.log(tell(() => require("bun:fs")), tell(() => module.require("bun:fs")));
console.log(tell(() => made("bun:fs")));
console.log(tell(() => require.call(null, "bun:fs")));
console.log(tell(() => module.require.call(module, "bun:fs")));
