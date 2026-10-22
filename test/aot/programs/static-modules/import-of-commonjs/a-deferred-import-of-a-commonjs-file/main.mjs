// `import defer` of a CommonJS file. `bun run` runs an imported CommonJS file while it links the importer, deferred or not.
import defer * as c from "./c.cjs";
console.log("main begins");
console.log(c.name, c.default.name);
