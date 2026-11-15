// As a-timer-that-a-function-of-the-program-hands-on, where the timer is an argument: the signature that refuses it is the program's own.
export {};
function ring(): void {
  console.log("rang");
}
function later(run: () => void) {
  return setTimeout(run, 1);
}
function kind(id: number) {
  return typeof id;
}
console.log(kind(later(ring)));
