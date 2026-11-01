// Bun's bundler writes `createRequire(import.meta.url)` for its `__require` helper and exports it from a chunk.
import { __require } from "./chunk.mjs";
console.log(__require("./inside.cjs"), __require("external-package").name, __require("node:os").EOL.length);
