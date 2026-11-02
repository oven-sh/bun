import * as forth from "./cycle.js";
function read(ns) { return ns.tooEarly; }
export const late = "late";
export let sawTooEarly;
try {
  sawTooEarly = "read " + read(forth);
} catch (error) {
  sawTooEarly = "threw " + error.constructor.name;
}
