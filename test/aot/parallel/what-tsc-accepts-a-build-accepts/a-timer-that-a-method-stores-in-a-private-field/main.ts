// As a-timer-that-a-function-of-the-program-hands-on, through a private method into a private field with a written type.
export {};
function ring(): void {
  console.log("rang");
}
class Debouncer {
  private timer: number | undefined;
  private start(run: () => void) {
    return setTimeout(run, 1);
  }
  call(run: () => void) {
    this.timer = this.start(run);
    return typeof this.timer;
  }
}
console.log(new Debouncer().call(ring));
