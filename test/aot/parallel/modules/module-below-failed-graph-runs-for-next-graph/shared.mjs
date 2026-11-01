console.log("shared runs");
let count = 0;
export function next() {
  return ++count;
}
globalThis.sharedHasRun = true;
