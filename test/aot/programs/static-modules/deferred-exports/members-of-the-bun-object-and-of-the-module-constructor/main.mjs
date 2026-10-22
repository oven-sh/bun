import { version } from "bun";
import { builtinModules } from "node:module";
const rest = await import("./rest.mjs");
console.log(typeof version, Array.isArray(builtinModules), rest.describe());
