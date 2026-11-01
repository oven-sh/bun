// Another file stores the es module marker of a file ahead of its import.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import "./clears-the-marker.cjs";
import "./would-clear-the-marker.cjs";
import cleared, { other as otherOfCleared } from "./marked.cjs";
import * as allOfCleared from "./marked.cjs";
import kept from "./stays-marked.cjs";
import throughGetter from "./hands-on-the-default.cjs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
console.log(JSON.stringify(cleared), otherOfCleared);
console.log(JSON.stringify(allOfCleared), JSON.stringify(allOfCleared.default));
console.log(JSON.stringify(kept));
console.log(typeof throughGetter, JSON.stringify(throughGetter));
console.log(require("./marked.cjs").__esModule, require("./stays-marked.cjs").__esModule);
