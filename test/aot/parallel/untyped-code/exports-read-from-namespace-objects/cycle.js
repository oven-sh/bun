import * as back from "./cycleBack.js";
function read(ns) { return ns.late + ", and the other way round it " + ns.sawTooEarly; }
export const tooEarly = 1;
export let early;
try {
  early = "read " + read(back);
} catch (error) {
  early = "threw " + error.constructor.name;
}
