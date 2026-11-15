import whole, { state, inc, isWrapper } from "wrapped";
const r = require("wrapped");
console.log(r.state === state, r.inc(), inc(), state.count, isWrapper, r.isWrapper, whole === r, r.whole());
