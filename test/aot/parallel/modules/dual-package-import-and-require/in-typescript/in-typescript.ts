import { state, inc } from "wrapped";
function load(): any {
  return require("wrapped");
}
console.log(inc(), load().inc(), state.count, load().state === state, load().isWrapper);
