// A method of an object literal is made into a function when somebody first asks for it: here in the first turn of a loop.
// The loop leaves its fast form for that and comes back to it, and has to read again what it read in front of the loop.
const none: number = Date.now() < 99 ? 1 : 0;
function say(...parts: unknown[]): void {}
function tell(): void {}
function fail(really: boolean): void {}
export let held1: number = 1 + 0.5;
function poke1(by: number): void {
  held1 = held1 * 1.5 + by;
}
const proxy1 = new Proxy({} as Record<string, number>, {
  get(): number {
    poke1(3);
    return 3;
  },
  has(): boolean {
    poke1(4);
    return true;
  },
});
{
  {
    const work = (turns: number): void => {
      let seen = "",
        sum = 0;
      let at = 0;
      do {
        sum += proxy1.any;
      } while (++at < turns);
    };
    work(4 + none);
  }
}
console.log(held1);
