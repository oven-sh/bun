// A `--define` whose value is the name of an enum of a function reads the object of the enum behind its declaration. Where a second declaration of the enum never runs, `bun run` removes that one alone: it declares the name once, at the first, and the value still reads the object.
// Flags: --define NAME=kind --define AGAIN=twice
declare const NAME: unknown, AGAIN: unknown;
(globalThis as any).kind = "the global";
(globalThis as any).twice = "the global";
function behindTheEnum() {
  enum kind {
    A,
  }
  return typeof NAME;
}
function declaredAgainBehindAReturn() {
  enum twice {
    A,
  }
  return typeof AGAIN;
  enum twice {
    B = 1,
  }
}
console.log(behindTheEnum(), declaredAgainBehindAReturn());
export {};
