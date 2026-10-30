// Compiled code takes the prototype of a host class from an instance, names the member, and replaces the getter: every read afterward finds the replacement, as in plain Bun.
const signal = AbortSignal.abort();
const read = (from: AbortSignal): unknown => from.aborted;
function readMany(): unknown {
  let last: unknown;
  for (let round = 0; round < 100; round++) last = read(signal);
  return last;
}
function replace(): void {
  Object.defineProperty(Object.getPrototypeOf(signal) as object, "aborted", { get: () => "replaced", configurable: true });
}
console.log("before:", readMany());
try {
  replace();
  console.log("replaced:", readMany(), read(AbortSignal.abort()));
} catch (error) {
  console.log("threw", (error as Error).name, readMany());
}
