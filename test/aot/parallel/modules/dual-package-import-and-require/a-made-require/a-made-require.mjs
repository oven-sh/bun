import { state, inc } from "wrapped";
import { createRequire } from "node:module";
const require2 = createRequire(import.meta.url);
const r = require2("wrapped");
console.log(r.state === state, r.inc(), inc(), state.count, r.isWrapper);
