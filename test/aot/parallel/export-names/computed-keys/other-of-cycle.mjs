import * as cycle from "./cycle.mjs";
export const seen = [];
export function read(key) {
  return cycle[key];
}
for (const key of ["firstOf" + "Cycle", ["second", "OfCycle"].join("")]) {
  try {
    seen.push(read(key));
  } catch (error) {
    seen.push(error.name + ": " + error.message);
  }
}
try {
  seen.push(Object.keys(cycle).join());
} catch (error) {
  seen.push(error.name + ": " + error.message);
}
