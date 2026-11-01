// Flags: --aot-validate
// Alone: its build ends with an internal error, which the programs beside it would share
// Todo: the build ends with InvalidLayout. The cast names X as the base of A, X extends A, and the two bases close a ring (oven-sh/WebKit#980, "What stays"). Without --aot-validate the executable never returns.
// A class extends a value that a cast gives the type of a second class, and the second class extends the first.
const early = process.argv.length < 5;
function pickForA(): any {
  return early ? null : X;
}
function pickForX(): any {
  return A;
}
class A extends (pickForA() as typeof X) {}
class X extends pickForX() {}
console.log(Object.getPrototypeOf(X) === A, Object.getPrototypeOf(A.prototype));
