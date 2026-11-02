// Compiled code names the prototype of a host class and gets the name of the member as an argument, and replaces the getter: every read afterward finds the replacement, as in plain Bun.
const signal = AbortSignal.abort();
const read = (from: AbortSignal): unknown => from.aborted;
function readMany(): unknown {
  let last: unknown;
  for (let round = 0; round < 100; round++) last = read(signal);
  return last;
}
function replaceUnder(name: string): void {
  Object.defineProperty(AbortSignal.prototype, name, { get: () => "replaced", configurable: true });
}
function replace(): void {
  replaceUnder("aborted");
}
console.log("before:", readMany());
try {
  replace();
  console.log("replaced:", readMany(), read(AbortSignal.abort()));
} catch (error) {
  console.log("threw", (error as Error).name, readMany());
}
