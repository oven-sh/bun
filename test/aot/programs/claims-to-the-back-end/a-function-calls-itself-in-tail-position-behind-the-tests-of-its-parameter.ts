// The tests of the parameter and the body go on with tail calls, so a million turns take no stack.
declare const console: any;
function attempt(name: string, f: () => unknown) {
  try {
    console.log(name + ": " + f());
  } catch (e: any) {
    console.log(name + ": " + e.constructor.name);
  }
}
const N = 1_000_000;
function viaCall(n: number): number {
  return n === 0 ? 0 : viaCall.call(undefined, n - 1);
}
attempt("call", () => viaCall(N));
