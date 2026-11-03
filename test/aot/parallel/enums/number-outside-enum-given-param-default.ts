// TypeScript lets any number into a numeric enum. Here 2 ** 31, which no 32-bit integer holds, is all that is ever given for a parameter of the enum's type that has a default; it is copied into a `let` and read by a closure.
enum Mode {
  Off,
  On,
}
function see(run: () => unknown): unknown {
  try {
    return run();
  } catch (error) {
    return error;
  }
}
function inner(first: number, mode = Mode.On): string {
  let local = mode;
  return first + " " + see(() => local) + " " + typeof local;
}
function probe(mode: Mode): string {
  return inner(1, mode);
}
const loose = 2 ** 31;
console.log(probe(loose));

// The same where several numbers and the default come by.
function innerOfMany(first: number, mode = Mode.On): string {
  let local = mode;
  return first + " " + see(() => local) + " " + typeof local;
}
const half = 1 / 2;
console.log(innerOfMany(1, loose), innerOfMany(2, Mode.Off), innerOfMany(3), innerOfMany(4, half), innerOfMany(5, -(2 ** 40)));
