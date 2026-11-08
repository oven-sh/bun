// As a-timer-that-a-function-of-the-program-hands-on, where only an inner line of the error names the type.
export {};
function ring(): void {
  console.log("rang");
}
function both(run: () => void) {
  return [setTimeout(run, 1), setTimeout(run, 2)];
}
const ids: number[] = both(ring);
console.log(ids.length, typeof ids[0]);
