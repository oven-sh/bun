// 40 levels of ES modules, each `export *` from both below. The leaves are CommonJS modules: what they export is known when they have run.
import { first, second } from "./left-40.mjs";
import * as right from "./right-40.mjs";
console.log(first, second, right.first, right.missing === undefined, Object.keys(right).join());
