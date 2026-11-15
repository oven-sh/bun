// No file spells `children`, `parent`, `require.main` or `process.mainModule`, and one reads `require` under a key that comes from outside. That read may be of `require.main`,
// so it counts as naming it, and all four answer as under `bun run`, under computed keys too.
// Alone: it asks which file the executable was started as (import.meta.main, require.main, module.id, module.parent, process.argv[1])
const keys = (process.env.NO_SUCH_VARIABLE ?? "children parent main mainModule").split(" ");
require("./child.cjs");
console.log(typeof module[keys[0]], typeof require("./child.cjs").itself[keys[1]], typeof require[keys[2]], typeof process[keys[3]]);
console.log(require[keys[2]] === module, module[keys[0]][0] === require("./child.cjs").itself, require("./child.cjs").itself[keys[1]] === module, process[keys[3]] === module);
