// The name of setup.cjs comes out of config.json, and an import() takes it. setup.cjs says nothing of its kind, and nothing requires it: it is read as an import reads it.
import config from "./config.json";
const loaded = await import(config.setup);
console.log(globalThis.madeUpKind, "|", Object.keys(loaded).join(","), Object.prototype.toString.call(loaded));
