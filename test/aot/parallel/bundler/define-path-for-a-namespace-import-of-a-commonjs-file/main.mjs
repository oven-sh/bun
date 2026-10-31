// A `--define` of `import.meta.env.ALL` whose value is the name of a namespace import reads the namespace object of a CommonJS file, in a module that also reads a member of the import by its name.
// Flags: --define import.meta.env.ALL=ns
import * as ns from "./lib.cjs";
console.log(ns.first, Object.keys(import.meta.env.ALL).join());
