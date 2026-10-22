import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
console.log(typeof require, typeof require.resolve, require("node:path").join("a", "b"));
