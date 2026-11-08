// The project names the DOM's library and no types: there `setTimeout` answers a number, and tsc accepts this. The declarations that the build brings along say `Timer`.
// The function has no written result, so the error would name a type that the project never installed.
export {};
function ring(): void {
  console.log("rang");
}
function later(run: () => void) {
  return setTimeout(run, 1);
}
const id: number = later(ring);
console.log(typeof id);
